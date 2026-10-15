/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createSocket, Socket } from "node:dgram";
import { isIPv4 } from "node:net";

import { AudioPacketBuffer, isAudioPacket } from "@plugins/streamSoundDelay.discordDesktop/packetBuffer";

export class AudioRelay {
    private local = createSocket("udp4");
    private remote = createSocket("udp4");
    private clientPort: number | undefined;
    private discoverySSRC: number | undefined;
    private ready = false;
    private closed = false;
    private pending: Buffer[] = [];
    private audioTypes = new Set([120]);
    private buffer = new AudioPacketBuffer<Buffer>(packet => this.sendToClient(packet));
    private error: string | undefined;
    port = 0;

    constructor() {
        this.local.on("error", error => this.fail(error));
        this.remote.on("error", error => this.fail(error));
        this.local.on("message", (packet, peer) => {
            if (this.closed || peer.address !== "127.0.0.1") return;
            const discovery = packet.length === 74 && packet.readUInt16BE(0) === 1 && packet.readUInt16BE(2) === 70;
            if (this.clientPort == null) this.clientPort = peer.port;
            if (this.clientPort !== peer.port) {
                // A native fast reconnect may replace the local UDP socket.
                if (!discovery || this.discoverySSRC == null || packet.readUInt32BE(4) !== this.discoverySSRC) return;
                this.clientPort = peer.port;
            }
            if (discovery) this.discoverySSRC = packet.readUInt32BE(4);
            if (this.ready) this.send(this.remote, packet);
            // IPC configuration can arrive after the native discovery request.
            else if (this.pending.length < 16 && packet.length <= 2048) this.pending.push(packet);
        });
        this.remote.on("message", packet => {
            if (this.closed) return;
            if (isAudioPacket(packet, this.audioTypes)) {
                try {
                    this.buffer.push(packet);
                } catch (error) {
                    this.fail(error);
                    this.sendToClient(packet);
                }
            } else {
                this.sendToClient(packet);
            }
        });
    }

    async bind() {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            this.local.once("error", onError);
            this.local.bind(0, "127.0.0.1", () => {
                this.local.removeListener("error", onError);
                this.port = this.local.address().port;
                this.local.unref();
                resolve();
            });
        });
        return this.port;
    }

    async configure(address: string, port: number, milliseconds: number, payloadTypes: number[]) {
        if (this.closed || this.ready) throw new Error("Stream relay is already configured or closed.");
        if (!isIPv4(address) || !Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error("Invalid stream UDP endpoint.");
        if (!payloadTypes.length || payloadTypes.some(type => !Number.isInteger(type) || type < 96 || type > 127))
            throw new Error("Invalid stream audio payload types.");
        this.audioTypes = new Set(payloadTypes);
        this.buffer.setDelay(milliseconds);
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            this.remote.once("error", onError);
            this.remote.connect(port, address, () => {
                this.remote.removeListener("error", onError);
                this.remote.unref();
                this.ready = true;
                for (const packet of this.pending) this.send(this.remote, packet);
                this.pending = [];
                resolve();
            });
        });
    }

    setDelay(milliseconds: number) {
        if (this.closed) return;
        if (this.error && milliseconds !== 0) throw new Error(this.error);
        this.buffer.setDelay(milliseconds);
    }

    checkError() {
        if (this.error) throw new Error(this.error);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.buffer.clear();
        this.pending = [];
        for (const socket of [this.local, this.remote]) {
            try { socket.close(); } catch { }
        }
    }

    private send(socket: Socket, packet: Buffer) {
        if (this.closed) return;
        socket.send(packet, error => { if (error) this.fail(error); });
    }

    private sendToClient(packet: Buffer) {
        if (this.closed || this.clientPort == null) return;
        this.local.send(packet, this.clientPort, "127.0.0.1", error => { if (error) this.fail(error); });
    }

    private fail(error: unknown) {
        this.error ??= error instanceof Error ? error.message : String(error);
        // Restore immediate forwarding instead of accumulating an unbounded queue.
        this.buffer.setDelay(0);
    }
}
