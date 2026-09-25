import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { durationLabel } from '../media-labels';
import { FINISHED_WITHIN_S, PlaybackMemory } from '../playback-memory';

export type PlayerKind = 'video' | 'audio';

export const PLAYBACK_RATES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SEEK_STEP_S = 5;
const JUMP_STEP_S = 10;
const VOLUME_STEP = 0.1;
/** Controls fade out after this long without the pointer moving, while playing. */
const HIDE_CONTROLS_AFTER_MS = 2_500;
/** The position is written down this often while playing (and on pause, seek or leaving). */
const SAVE_EVERY_MS = 5_000;

/** What the player remembers about the file it plays. */
interface Session {
  readonly mediaId: string;
  readonly messageId: string;
  readonly title: string;
  readonly kind: PlayerKind;
}

/**
 * Plays a stored video or audio file. The browser streams it with range requests (it never loads
 * the whole file); the controls add playback speed, keyboard shortcuts, full screen and
 * picture-in-picture, and the player resumes where the file was left.
 *
 * Keys, while the player has focus: Space/K play or pause · ←/→ 5 s · J/L 10 s · ↑/↓ volume ·
 * M mute · F full screen · &lt; / &gt; speed · Home/End start or end.
 */
@Component({
  selector: 'app-video-player',
  imports: [
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatProgressSpinner,
    MatTooltip,
  ],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
  host: { '(document:fullscreenchange)': 'fullscreenChanged()' },
})
export class VideoPlayer {
  readonly src = input.required<string>();
  readonly kind = input<PlayerKind>('video');
  readonly poster = input<string | null>(null);
  readonly title = input('');
  /** Set to remember where the file was left (resume, "Continue watching"). */
  readonly mediaId = input<string | null>(null);
  readonly messageId = input<string | null>(null);
  /** Telegram's length of the file, shown until the file itself says. */
  readonly durationHint = input<number | null>(null);
  /** Offered when the browser cannot play the file. */
  readonly saveUrl = input<string | null>(null);

  private readonly memory = inject(PlaybackMemory);
  private readonly document = inject(DOCUMENT);
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly mediaElement = viewChild.required<ElementRef<HTMLMediaElement>>('media');

  protected readonly rates = PLAYBACK_RATES;
  protected readonly playing = signal(false);
  protected readonly waiting = signal(false);
  protected readonly failed = signal(false);
  protected readonly position = signal(0);
  private readonly knownDuration = signal<number | null>(null);
  protected readonly duration = computed(() => this.knownDuration() ?? this.durationHint() ?? 0);
  protected readonly bufferedTo = signal(0);
  protected readonly volume = signal(1);
  protected readonly muted = signal(false);
  protected readonly rate = signal(1);
  protected readonly fullscreen = signal(false);
  protected readonly resumedAt = signal<number | null>(null);
  protected readonly idle = signal(false);
  protected readonly pipSupported =
    typeof document !== 'undefined' &&
    (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true;

  protected readonly playedPercent = computed(() => this.percent(this.position()));
  protected readonly bufferedPercent = computed(() => this.percent(this.bufferedTo()));
  protected readonly timeText = computed(
    () =>
      `${durationLabel(Math.floor(this.position())) ?? '0:00'} / ${durationLabel(this.duration()) ?? '0:00'}`,
  );
  protected readonly resumedText = computed(() => durationLabel(this.resumedAt()));
  protected readonly volumeIcon = computed(() =>
    this.muted() || this.volume() === 0
      ? 'volume_off'
      : this.volume() < 0.5
        ? 'volume_down'
        : 'volume_up',
  );

  private session: Session | null = null;
  private lastSaved = 0;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const preferences = this.memory.preferences();
    this.volume.set(preferences.volume);
    this.muted.set(preferences.muted);
    this.rate.set(preferences.rate);
    afterNextRender(() => {
      const media = this.media();
      media.volume = preferences.volume;
      media.muted = preferences.muted;
      media.playbackRate = preferences.rate;
    });
    inject(DestroyRef).onDestroy(() => {
      this.save();
      clearTimeout(this.hideTimer);
    });
  }

  protected toggle(): void {
    const media = this.media();
    if (media.paused) {
      void media.play()?.catch(() => undefined);
    } else {
      media.pause();
    }
  }

  protected seekTo(seconds: number): void {
    const media = this.media();
    const end = this.duration() || media.duration || 0;
    media.currentTime = Math.min(Math.max(0, seconds), Number.isFinite(end) ? end : 0);
    this.position.set(media.currentTime);
    this.resumedAt.set(null);
  }

  protected seekBy(seconds: number): void {
    this.seekTo(this.media().currentTime + seconds);
  }

  protected seekInput(event: Event): void {
    this.seekTo(Number((event.target as HTMLInputElement).value));
  }

  protected setVolume(value: number): void {
    const media = this.media();
    media.volume = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    if (media.volume > 0 && media.muted) {
      media.muted = false;
    }
  }

  protected volumeInput(event: Event): void {
    this.setVolume(Number((event.target as HTMLInputElement).value));
  }

  protected toggleMute(): void {
    const media = this.media();
    media.muted = !media.muted;
  }

  protected setRate(rate: number): void {
    this.media().playbackRate = rate;
  }

  protected stepRate(direction: 1 | -1): void {
    const index = this.rates.indexOf(this.rate());
    const next =
      this.rates[Math.min(this.rates.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
    if (next !== undefined) {
      this.setRate(next);
    }
  }

  protected startOver(): void {
    this.seekTo(0);
  }

  protected toggleFullscreen(): void {
    if (this.document.fullscreenElement) {
      void this.document.exitFullscreen?.().catch(() => undefined);
    } else {
      void this.frame()
        .nativeElement.requestFullscreen?.()
        .catch(() => undefined);
    }
  }

  protected togglePictureInPicture(): void {
    const video = this.media() as HTMLVideoElement;
    const doc = this.document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };
    if (doc.pictureInPictureElement) {
      void doc.exitPictureInPicture?.().catch(() => undefined);
    } else {
      void video.requestPictureInPicture?.().catch(() => undefined);
    }
  }

  protected fullscreenChanged(): void {
    this.fullscreen.set(this.document.fullscreenElement === this.frame().nativeElement);
  }

  /** Shows the controls again, and hides them after a while if playing. */
  protected poke(): void {
    this.idle.set(false);
    clearTimeout(this.hideTimer);
    if (this.playing() && this.kind() === 'video') {
      this.hideTimer = setTimeout(() => this.idle.set(true), HIDE_CONTROLS_AFTER_MS);
    }
  }

  protected key(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const onSlider = target instanceof HTMLInputElement && target.type === 'range';
    if (onSlider && event.key.startsWith('Arrow')) {
      return; // The slider handles its own arrows.
    }
    if (
      target?.closest('button, a, [role="menuitem"]') &&
      (event.key === ' ' || event.key === 'Enter')
    ) {
      return; // Buttons keep Space and Enter.
    }
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        this.toggle();
        break;
      case 'ArrowLeft':
        this.seekBy(-SEEK_STEP_S);
        break;
      case 'ArrowRight':
        this.seekBy(SEEK_STEP_S);
        break;
      case 'j':
      case 'J':
        this.seekBy(-JUMP_STEP_S);
        break;
      case 'l':
      case 'L':
        this.seekBy(JUMP_STEP_S);
        break;
      case 'ArrowUp':
        this.setVolume(this.volume() + VOLUME_STEP);
        break;
      case 'ArrowDown':
        this.setVolume(this.volume() - VOLUME_STEP);
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
      case 'f':
      case 'F':
        if (this.kind() !== 'video') {
          return;
        }
        this.toggleFullscreen();
        break;
      case '<':
        this.stepRate(-1);
        break;
      case '>':
        this.stepRate(1);
        break;
      case 'Home':
        this.seekTo(0);
        break;
      case 'End':
        this.seekTo(this.duration());
        break;
      default:
        return;
    }
    event.preventDefault();
    this.poke();
  }

  // ---- media element events ----------------------------------------------------------------

  protected loadedMetadata(): void {
    const media = this.media();
    this.failed.set(false);
    this.knownDuration.set(Number.isFinite(media.duration) ? media.duration : null);
    const mediaId = this.mediaId();
    const messageId = this.messageId();
    this.session =
      mediaId && messageId ? { mediaId, messageId, title: this.title(), kind: this.kind() } : null;
    const saved = mediaId ? this.memory.position(mediaId) : null;
    if (saved !== null && saved < this.duration() - FINISHED_WITHIN_S) {
      media.currentTime = saved;
      this.position.set(saved);
      this.resumedAt.set(saved);
    }
  }

  protected timeUpdate(): void {
    this.position.set(this.media().currentTime);
    if (this.playing() && Date.now() - this.lastSaved > SAVE_EVERY_MS) {
      this.save();
    }
  }

  protected progress(): void {
    const media = this.media();
    const ranges = media.buffered;
    let end = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) <= media.currentTime + 0.5) {
        end = Math.max(end, ranges.end(index));
      }
    }
    this.bufferedTo.set(end);
  }

  protected played(): void {
    this.playing.set(true);
    this.waiting.set(false);
    this.poke();
  }

  protected paused(): void {
    this.playing.set(false);
    this.idle.set(false);
    this.save();
  }

  protected ended(): void {
    this.playing.set(false);
    this.idle.set(false);
    this.resumedAt.set(null);
    if (this.session) {
      this.memory.forget(this.session.mediaId);
    }
  }

  protected volumeChanged(): void {
    const media = this.media();
    this.volume.set(media.volume);
    this.muted.set(media.muted);
    this.savePreferences();
  }

  protected rateChanged(): void {
    this.rate.set(this.media().playbackRate);
    this.savePreferences();
  }

  protected errored(): void {
    if (this.media().error) {
      this.failed.set(true);
      this.waiting.set(false);
    }
  }

  /** Another file replaces this one: note where the old one stopped first. */
  protected emptied(): void {
    this.save();
    this.session = null;
    this.position.set(0);
    this.knownDuration.set(null);
    this.resumedAt.set(null);
  }

  private save(): void {
    const session = this.session;
    const duration = this.duration();
    if (!session || duration <= 0) {
      return;
    }
    this.lastSaved = Date.now();
    this.memory.remember({ ...session, position: this.position(), duration });
  }

  private savePreferences(): void {
    this.memory.savePreferences({ volume: this.volume(), muted: this.muted(), rate: this.rate() });
  }

  private media(): HTMLMediaElement {
    return this.mediaElement().nativeElement;
  }

  private percent(seconds: number): number {
    const duration = this.duration();
    return duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0;
  }
}
