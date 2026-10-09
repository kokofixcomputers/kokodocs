import { Recorder } from '../voice/recorder'

/** Live captions: listens to your own microphone, cuts it into sentences wherever you pause, and sends each one to be turned into text.
 *  Only your own speech is sent (everyone's browser does the same for theirs), and only while captions are on for the meeting. */
export class Captioner {
  private rec = new Recorder()
  private timer: ReturnType<typeof setInterval> | null = null
  private speaking = false
  private voiced = 0
  private quiet = 0
  private busy = 0

  constructor(private mic: MediaStream, private send: (wav: Blob) => Promise<void>) {}

  async start() {
    await this.rec.start(this.mic)
    this.timer = setInterval(() => this.tick(), 100)
  }

  private tick() {
    const loud = this.rec.level() > 0.07
    if (loud) { this.voiced += 100; this.quiet = 0; this.speaking = true } else this.quiet += 100
    if (this.speaking && (this.quiet >= 700 || this.voiced + this.quiet >= 12000)) this.flush()
    else if (!this.speaking && this.quiet >= 500) this.rec.trim(0.4)
  }

  private flush() {
    const enough = this.voiced >= 400
    const wav = this.rec.take()
    this.speaking = false; this.voiced = 0; this.quiet = 0
    if (enough && wav && this.busy < 2) { this.busy++; void this.send(wav).catch(() => {}).finally(() => { this.busy-- }) }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.rec.cancel()
  }
}
