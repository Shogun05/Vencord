/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { delayMilliseconds } from "@plugins/streamSoundDelay.discordDesktop/packetBuffer";
import { Slider, TextInput, useEffect, useRef, useState } from "@webpack/common";

interface DelayControlProps {
    initialValue: number;
    onChange(value: number): void;
}

const markers = Array.from({ length: 101 }, (_, index) => index / 10);
const normalize = (value: number) => delayMilliseconds(value) / 1000;

export function DelayControl({ initialValue, onChange }: DelayControlProps) {
    const [value, setValue] = useState(() => normalize(initialValue));
    const [input, setInput] = useState(() => normalize(initialValue).toFixed(1));
    const latest = useRef(value);

    useEffect(() => {
        const next = normalize(initialValue);
        if (next === latest.current) return;
        latest.current = next;
        setValue(next);
        setInput(next.toFixed(1));
    }, [initialValue]);

    function update(next: number, formatInput = true) {
        next = normalize(next);
        latest.current = next;
        setValue(next);
        if (formatInput) setInput(next.toFixed(1));
        onChange(next);
    }

    function changeInput(text: string) {
        setInput(text);
        const next = Number(text);
        if (text.trim() !== "" && Number.isFinite(next) && next >= 0 && next <= 10) update(next, false);
    }

    function finishInput() {
        const next = Number(input);
        update(input.trim() !== "" && Number.isFinite(next) ? next : latest.current);
    }

    return (
        <section aria-label="Stream audio delay">
            <Heading>Stream audio delay</Heading>
            <Paragraph>Delay in seconds (0–10). Changing it clears queued audio. Reopen streams after first enabling the plugin.</Paragraph>
            <Flex gap="8px" alignItems="center" style={{ marginBottom: "16px" }}>
                <Button type="button" size="small" variant="secondary" aria-label="Decrease delay by 0.1 seconds" disabled={value === 0} onClick={() => update(latest.current - 0.1)}>←</Button>
                <div style={{ flex: "0 0 10%", minWidth: 0 }}>
                    <TextInput
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        aria-label="Audio delay in seconds"
                        value={input}
                        onChange={changeInput}
                        onBlur={finishInput}
                        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                </div>
                <Button type="button" size="small" variant="secondary" aria-label="Increase delay by 0.1 seconds" disabled={value === 10} onClick={() => update(latest.current + 0.1)}>→</Button>
            </Flex>
            <Slider
                initialValue={value}
                minValue={0}
                maxValue={10}
                markers={markers}
                stickToMarkers
                keyboardStep={0.1}
                onValueChange={update}
                onValueRender={value => `${value.toFixed(1)} s`}
                onMarkerRender={value => Number.isInteger(value) ? `${value} s` : null}
                getAriaValueText={value => `${value.toFixed(1)} seconds`}
                aria-label="Stream audio delay slider"
            />
        </section>
    );
}
