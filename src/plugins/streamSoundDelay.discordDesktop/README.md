# StreamSoundDelay

Original creator: shogun05 (Discord ID `524597801942777857`).

Buffers incoming stream audio in official Discord desktop for **0–10 seconds**,
in **0.1-second steps**. Voice chat uses its original connection and stays live.
Use the numeric input or the left/right buttons above the slider for precise
adjustments. Each button changes the delay by 0.1 seconds.

Incoming stream connections use a local relay that buffers encrypted audio
packets in memory. Video and control packets pass through immediately. Discord
handles decryption, decoding, volume, mute and playback. Nothing is saved to disk.

After installing this version, fully restart Discord and reopen the watched
stream. Connections created before the relay was ready must be reopened.

Changing the slider clears queued audio and starts filling at the new delay.
Zero forwards incoming packets immediately. Ending a stream closes its relay;
disabling the plugin uses passthrough for existing relayed connections until
they end, preserving their negotiated UDP endpoint.

The queue is limited to 4 MiB and 4,096 packets per stream. A capacity failure
clears it and restores immediate forwarding. Live playback and DAVE key
transitions still need validation before upstream submission.

AI assistance: Codex assisted with debugging,
and testing.
