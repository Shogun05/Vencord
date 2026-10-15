/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function delayMilliseconds(seconds: number): number {
    return Number.isFinite(seconds) ? Math.round(Math.min(10, Math.max(0, seconds)) * 10) * 100 : 0;
}

export class AudioPacketBuffer<T extends Uint8Array> {
    private packets: { data: T; due: number; }[] = [];
    private head = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private milliseconds = 0;
    private queuedBytes = 0;

    constructor(private release: (data: T) => void) { }

    get queuedPackets() { return this.packets.length - this.head; }

    setDelay(milliseconds: number) {
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000)
            throw new RangeError("Audio delay must be between 0 and 10000 milliseconds.");
        if (milliseconds === this.milliseconds) return;
        this.clear();
        this.milliseconds = milliseconds;
    }

    push(data: T) {
        if (this.milliseconds === 0) {
            this.release(data);
            return;
        }
        if (this.queuedPackets >= 4096 || this.queuedBytes + data.byteLength > 4 * 1024 * 1024)
            throw new Error("Stream audio buffer capacity exceeded.");
        this.packets.push({ data, due: performance.now() + this.milliseconds });
        this.queuedBytes += data.byteLength;
        this.schedule();
    }

    clear() {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.packets = [];
        this.head = 0;
        this.queuedBytes = 0;
    }

    private schedule() {
        if (this.timer != null || this.queuedPackets === 0) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const now = performance.now();
            while (this.head < this.packets.length && this.packets[this.head].due <= now) {
                const packet = this.packets[this.head++];
                this.queuedBytes -= packet.data.byteLength;
                this.release(packet.data);
            }
            if (this.head > 256 || this.head === this.packets.length) {
                this.packets = this.packets.slice(this.head);
                this.head = 0;
            }
            this.schedule();
        }, Math.max(1, Math.ceil(this.packets[this.head].due - performance.now())));
        this.timer.unref?.();
    }
}

export function isAudioPacket(packet: Uint8Array, payloadTypes: ReadonlySet<number>): boolean {
    if (packet.length < 12 || (packet[0] >>> 6) !== 2) return false;
    // RTCP uses the full second byte, whereas RTP also has a marker bit.
    if (packet[1] >= 192 && packet[1] <= 223) return false;
    if (packet.length < 12 + (packet[0] & 15) * 4) return false;
    return payloadTypes.has(packet[1] & 127);
}
