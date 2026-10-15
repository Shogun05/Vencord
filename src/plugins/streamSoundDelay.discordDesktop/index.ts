/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { DelayControl } from "@plugins/streamSoundDelay.discordDesktop/DelayControl";
import { delayMilliseconds } from "@plugins/streamSoundDelay.discordDesktop/packetBuffer";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { React, showToast } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StreamSoundDelay as PluginNative<typeof import("./native")>;
const logger = new Logger("StreamSoundDelay");

interface StreamConnection {
    context: string;
    userId: string;
    streamUserId?: string;
    destroyed: boolean;
    once(event: "Destroy", listener: () => void): unknown;
}

interface TransportOptions {
    address: string;
    port: number;
    audioCodec?: { payloadType: number; };
}

interface NativeConnection {
    setUdpEndpoint?: (address: string, port: number) => void;
}

interface Slot { id: string; port: number; }
interface Session { slot: Slot; milliseconds: number; ready: boolean; released: boolean; }

const sessions = new Map<StreamConnection, Session>();
let available: Slot[] = [];
let running = false;
let reserving = false;
let notified = false;
let checking = false;
let interval: ReturnType<typeof setInterval> | undefined;
let generation = 0;

const settings = definePluginSettings({
    delaySeconds: {
        type: OptionType.COMPONENT,
        default: 0,
        component: ({ setValue }) => React.createElement(DelayControl, { initialValue: settings.store.delaySeconds, onChange: setValue }),
        onChange: updateDelays
    }
});

function reportFailure(message: string, error?: unknown) {
    if (notified) return;
    notified = true;
    logger.error(message, error);
    showToast(message, "failure");
}

async function reserve() {
    if (!running || reserving || available.length >= 2) return;
    reserving = true;
    const current = generation;
    try {
        const slots = await Native.reserve();
        if (!running || generation !== current) {
            await Promise.all(slots.map(slot => Native.release(slot.id)));
            return;
        }
        available.push(...slots);
    } catch (error) {
        reportFailure("Could not start the stream audio buffer. Normal stream playback is preserved.", error);
    } finally {
        reserving = false;
    }
}

function retire(owner: StreamConnection, session: Session) {
    if (session.released) return;
    session.released = true;
    if (sessions.get(owner) === session) sessions.delete(owner);
    Native.release(session.slot.id).catch(error => logger.warn("Could not close stream audio relay", error));
}

function createConnection(owner: StreamConnection, options: TransportOptions, create: () => NativeConnection): NativeConnection {
    if (!running || owner.context !== "stream" || owner.streamUserId == null || owner.streamUserId === owner.userId)
        return create();

    const slot = available.shift();
    if (!slot) {
        reportFailure("The audio buffer is not ready. Reopen the stream after it becomes ready.");
        void reserve();
        return create();
    }

    const { address, port } = options;
    const milliseconds = delayMilliseconds(settings.store.delaySeconds);
    const payloadTypes = [options.audioCodec?.payloadType ?? 120];
    const previous = sessions.get(owner);
    if (previous) retire(owner, previous);
    const session: Session = { slot, milliseconds, ready: false, released: false };
    sessions.set(owner, session);
    owner.once("Destroy", () => retire(owner, session));

    // Reserve sockets ahead of time: Discord's connection factory is synchronous.
    // The relay queues discovery packets until this IPC configuration is complete.
    const configured = Native.configure(slot.id, address, port, milliseconds, payloadTypes);
    options.address = "127.0.0.1";
    options.port = slot.port;
    let native: NativeConnection;
    try {
        native = create();
    } catch (error) {
        // Attach a rejection handler even if the native factory fails immediately.
        configured.catch(() => { });
        retire(owner, session);
        throw error;
    } finally {
        options.address = address;
        options.port = port;
    }
    configured.then(() => {
        if (sessions.get(owner) !== session) return;
        session.ready = true;
        updateDelays();
    }).catch(error => {
        native.setUdpEndpoint?.(address, port);
        retire(owner, session);
        reportFailure("Stream audio relay setup failed. Reopen the stream for normal playback.", error);
    });
    void reserve();
    return native;
}

function updateDelays() {
    const milliseconds = running ? delayMilliseconds(settings.store.delaySeconds) : 0;
    for (const session of sessions.values()) {
        if (!session.ready || session.milliseconds === milliseconds) continue;
        session.milliseconds = milliseconds;
        Native.setDelay(session.slot.id, milliseconds).catch(error => reportFailure("Could not update the stream audio buffer.", error));
    }
}

async function checkConnections() {
    if (!running || checking) return;
    const ids = Array.from(sessions.values()).filter(session => session.ready).map(session => session.slot.id);
    if (!ids.length) return;
    checking = true;
    const current = generation;
    try {
        await Native.checkConnections(ids);
    } catch (error) {
        const active = new Set(Array.from(sessions.values()).map(session => session.slot.id));
        if (running && current === generation && ids.every(id => active.has(id)))
            reportFailure("The stream audio buffer stopped delaying after a transport error. Reopen the stream.", error);
    } finally {
        checking = false;
    }
}

export default definePlugin({
    name: "StreamSoundDelay",
    description: "Buffers incoming stream audio for up to ten seconds. Video and voice chat are forwarded live.",
    authors: [Devs.shogun05],
    tags: ["Voice", "Utility"],
    settings,
    createConnection,

    patches: [{
        find: "createOwnStreamConnectionWithOptions",
        replacement: {
            match: /(\i)=this\.conn=(\i)\(this\.userId,(\i),(\i)\)/,
            replace: "$1=this.conn=$self.createConnection(this,$3,()=>$2(this.userId,$3,$4))"
        }
    }],

    start() {
        running = true;
        notified = false;
        generation++;
        void reserve();
        interval = setInterval(() => { void checkConnections(); }, 2000);
    },

    stop() {
        running = false;
        generation++;
        clearInterval(interval);
        interval = undefined;
        updateDelays();
        for (const slot of available) Native.release(slot.id).catch(error => logger.warn("Could not close unused relay", error));
        available = [];
        // Existing connections keep their relay in passthrough mode until destroyed.
        // Closing it here would break their negotiated UDP endpoint.
    }
});
