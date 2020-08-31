import * as MessagePack from 'msgpack-lite';

import { EventSystem } from '../system';
import { clearZeroTimeout, setZeroTimeout } from '../system/util/zero-timeout';
import { FileReaderUtil } from './file-reader-util';

interface ChankData {
  index: number;
  length: number;
  chank: Uint8Array;
}

export class BufferSharingTask<T> {
  private _identifier: string;
  get identifier(): string { return this._identifier };
  private _sendTo: string;
  get sendTo(): string { return this._sendTo };

  private data: T;
  private uint8Array: Uint8Array;
  private chanks: Uint8Array[] = [];
  private chankSize: number = 32 * 1024;
  private chankReceiveCount: number = 0;
  private sendChankTimer: number;

  private sentChankIndex = 0;
  private completedChankIndex = 0;

  private startTime = 0;
  private isCanceled = false;

  onprogress: (task: BufferSharingTask<T>, loded: number, total: number) => void;
  onfinish: (task: BufferSharingTask<T>, data: T) => void;
  ontimeout: (task: BufferSharingTask<T>) => void;
  oncancel: (task: BufferSharingTask<T>) => void;

  private timeoutTimer: NodeJS.Timer;
  private timeoutDate: number;

  private constructor(data?: T, sendTo?: string) {
    this.data = data;
    this.uint8Array = MessagePack.encode(data);
    this._sendTo = sendTo;
  }

  static async createSendTask<T>(data: T, sendTo: string, identifier?: string): Promise<BufferSharingTask<T>> {
    let task = new BufferSharingTask(data, sendTo);
    task._identifier = identifier != null ? identifier : await FileReaderUtil.calcSHA256Async(task.uint8Array);
    task.initializeSend();
    return task;
  }

  static createReceiveTask<T>(identifier: string): BufferSharingTask<T> {
    let task = new BufferSharingTask<T>();
    task._identifier = identifier;
    task.initializeReceive();
    return task;
  }

  private progress(loded: number, total: number) {
    if (this.onprogress) this.onprogress(this, loded, total);
  }

  private finish() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  private timeout() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    if (this.ontimeout) this.ontimeout(this);
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  cancel() {
    if (this.isCanceled) return;
    if (this.sendTo != null) EventSystem.call('CANCEL_TASK_' + this.identifier, null, this.sendTo);
    this._cancel();
  }

  private _cancel() {
    if (this.isCanceled) return;
    this.isCanceled = true;
    if (this.oncancel) this.oncancel(this);
    if (this.onfinish) this.onfinish(this, this.data);
    this.dispose();
  }

  private dispose() {
    EventSystem.unregister(this);
    if (this.sendChankTimer) clearZeroTimeout(this.sendChankTimer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.sendChankTimer = null;
    this.timeoutTimer = null;
    this.onprogress = this.onfinish = this.ontimeout = this.oncancel = null;
  }

  private initializeSend() {
    let total = Math.ceil(this.uint8Array.byteLength / this.chankSize);
    this.chanks = new Array(total);

    console.log('チャンク分割 ' + this.identifier, this.chanks.length);

    EventSystem.register(this)
      .on<number>('FILE_MORE_CHANK_' + this.identifier, event => {
        if (this.sendTo !== event.sendFrom) return;
        this.completedChankIndex = event.data;
        if (this.sendChankTimer == null) {
          clearTimeout(this.timeoutTimer);
          this.sendChank(this.sentChankIndex + 1);
        }
      })
      .on('DISCONNECT_PEER', event => {
        if (event.data.peer !== this.sendTo) return;
        console.warn('送信キャンセル（Peer切断）', this, event.data.peer);
        this._cancel();
      })
      .on('CANCEL_TASK_' + this.identifier, event => {
        console.warn('送信キャンセル', this, event.sendFrom);
        this._cancel();
      });
    this.sentChankIndex = this.completedChankIndex = 0;
    setZeroTimeout(() => this.sendChank(0));
  }

  private sendChank(index: number) {
    let chank = this.uint8Array.slice(index * this.chankSize, (index + 1) * this.chankSize);
    let data = { index: index, length: this.chanks.length, chank: chank };
    EventSystem.call('FILE_SEND_CHANK_' + this.identifier, data, this.sendTo);
    this.sentChankIndex = index;
    this.sendChankTimer = null;
    if (this.chanks.length <= index + 1) {
      console.log('バッファ送信完了', this.identifier);
      setZeroTimeout(() => this.finish());
    } else if (this.completedChankIndex + 4 <= index) {
      this.resetTimeout();
    } else {
      this.sendChankTimer = setZeroTimeout(() => { this.sendChank(this.sentChankIndex + 1); });
    }
  }

  private initializeReceive() {
    this.resetTimeout();
    this.startTime = performance.now();
    this.chankReceiveCount = 0;
    EventSystem.register(this)
      .on<ChankData>('FILE_SEND_CHANK_' + this.identifier, event => {
        if (this.chanks.length < 1) this.chanks = new Array(event.data.length);

        if (this.chanks[event.data.index] != null) {
          console.log(`already received. [${event.data.index}] <${this.identifier}>`);
          return;
        }
        this.chankReceiveCount++;
        this.chanks[event.data.index] = event.data.chank;
        this.progress(event.data.index, event.data.length);
        if (this.chanks.length <= this.chankReceiveCount) {
          this.finishReceive();
        } else {
          this.resetTimeout();
          EventSystem.call('FILE_MORE_CHANK_' + this.identifier, event.data.index, event.sendFrom);
        }
      })
      .on('DISCONNECT_PEER', event => {
        if (event.data.peer !== this.sendTo) return;
        console.warn('受信キャンセル（Peer切断）', this, event.data.peer);
        this._cancel();
      })
      .on('CANCEL_TASK_' + this.identifier, event => {
        console.warn('受信キャンセル', this, event.sendFrom);
        this._cancel();
      });
  }

  private finishReceive() {
    console.log('バッファ受信完了', this.identifier);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    EventSystem.unregister(this);

    let sumLength = 0;
    for (let chank of this.chanks) { sumLength += chank.byteLength; }

    let time = performance.now() - this.startTime;
    let rate = (sumLength / 1024 / 1024) / (time / 1000);
    console.log(`${(sumLength / 1024).toFixed(2)}KB ${(time / 1000).toFixed(2)}秒 転送速度: ${rate.toFixed(2)}MB/s`);

    let uint8Array = new Uint8Array(sumLength);
    let pos = 0;

    for (let chank of this.chanks) {
      uint8Array.set(chank, pos);
      pos += chank.byteLength;
    }

    this.data = MessagePack.decode(uint8Array);
    this.finish();
  }

  private resetTimeout() {
    this.timeoutDate = Date.now() + 15 * 1000;
    if (this.timeoutTimer !== null) return;
    this.setTimeout();
  }

  private setTimeout() {
    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = null;
      if (Date.now() < this.timeoutDate) {
        this.setTimeout();
      } else {
        this.timeout();
      }
    }, this.timeoutDate - Date.now());
  }
}
