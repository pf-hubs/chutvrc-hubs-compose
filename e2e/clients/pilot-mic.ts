// The IOS profiles' microphone (plan 2.5 on WebKit). Linux WebKit's mock microphone cannot play a clip file
// the way Chromium's --use-file-for-fake-audio-capture does, so the audio probe would have nothing to find.
// This init script wraps navigator.mediaDevices.getUserMedia: the page still gets WebKit's own stream (its
// mock camera, the device labels), but the audio track is replaced by one made with Web Audio: the slot's
// pilot beep, 250 ms once a second as in the clips, over quiet broadband noise (a noise floor around the
// pilot, as the clips have, so the analyser compares the beep with something). Everything after
// getUserMedia (the client's microphone handling, the media server, mute) is the client's own.
//
// The audio context may start suspended until the page sees a user gesture; it is resumed on the first
// pointer, touch, click or key event (Join Room is one), and again whenever WebKit suspends or interrupts it.

export function pilotMicrophone(pilotHz: number): string {
  return `(() => {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia || md.__e2ePilot) return;
  const original = md.getUserMedia.bind(md);
  let ctx = null;
  let destination = null;
  const source = () => {
    if (destination) return destination;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    destination = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.frequency.value = ${pilotHz};
    const gate = ctx.createGain();
    gate.gain.value = 0;
    osc.connect(gate);
    gate.connect(destination);
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.05;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 3000;
    shelf.gain.value = -12;
    noise.connect(shelf);
    shelf.connect(destination);
    osc.start();
    noise.start();
    // The beep starts on every whole second of the context's clock, for the next few seconds
    let scheduledUntil = 0;
    const schedule = () => {
      const now = ctx.currentTime;
      for (let s = Math.max(Math.ceil(now), scheduledUntil); s < now + 3; s++) {
        gate.gain.setValueAtTime(0.3, s);
        gate.gain.setValueAtTime(0, s + 0.25);
        scheduledUntil = s + 1;
      }
    };
    schedule();
    setInterval(schedule, 500);
    const resume = () => { if (ctx.state !== "running") ctx.resume().catch(() => {}); };
    for (const type of ["pointerdown", "touchend", "click", "keydown"]) window.addEventListener(type, resume, true);
    resume();
    // WebKit moves a context to "suspended" or "interrupted" (its audio session) on its own; the pilot is
    // brought back at once, as the client does with its own context (audio-system.js), and the change logged
    ctx.onstatechange = () => {
      console.info("[e2e] pilot microphone context " + ctx.state);
      if (ctx.state !== "running") setTimeout(resume, 100);
    };
    setInterval(resume, 2000);
    return destination;
  };
  md.getUserMedia = async function (constraints) {
    const stream = await original(constraints);
    if (constraints && constraints.audio) {
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
      }
      stream.addTrack(source().stream.getAudioTracks()[0].clone());
    }
    return stream;
  };
  md.__e2ePilot = ${pilotHz};
  window.__e2ePilotContext = () => (ctx ? ctx.state : "not created");
})();`;
}
