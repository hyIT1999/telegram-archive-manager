import { ENTER } from '@angular/cdk/keycodes';
import {
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MatAutocomplete,
  type MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import {
  MatChipGrid,
  MatChipInput,
  type MatChipInputEvent,
  MatChipRemove,
  MatChipRow,
} from '@angular/material/chips';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatHint } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { type Observable, finalize } from 'rxjs';
import {
  type AddMessageTagRequest,
  type MessageTagsDto,
  type TagDto,
  type TagRefDto,
  toApiError,
} from '../../shared/models';
import { startsWords } from '../../shared/text/searchable';
import { MessageChanges, tagsChanged } from '../messages/message-changes';
import { TAG_NAME_MAX_LENGTH, nextTagColor, tagKey } from './tag-palette';
import { TagStore } from './tag-store';
import { TagsApi } from './tags-api';

/** The option that creates a tag from the typed name. */
const CREATE = 'create';
/** Suggestions shown while typing. */
const MAX_OPTIONS = 20;

/**
 * The tags of one message: removable chips, and a field that suggests the archive's tags as
 * one types (without accents). Enter adds the suggestion, or creates a tag with a new name.
 */
@Component({
  selector: 'app-tag-editor',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatChipGrid,
    MatChipInput,
    MatChipRemove,
    MatChipRow,
    MatFormField,
    MatHint,
    MatIcon,
    MatOption,
  ],
  templateUrl: './tag-editor.html',
  styleUrl: './tag-editor.scss',
})
export class TagEditor {
  readonly messageId = input.required<string>();
  readonly tags = input.required<readonly TagRefDto[]>();

  private readonly api = inject(TagsApi);
  protected readonly store = inject(TagStore);
  private readonly changes = inject(MessageChanges);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild(MatAutocompleteTrigger);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly current = linkedSignal(() => this.tags());
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly separators = [ENTER];
  protected readonly create = CREATE;
  protected readonly maxLength = TAG_NAME_MAX_LENGTH;
  /** The input keeps what is typed, never an option's value. */
  protected readonly showNothing = () => '';

  private readonly typed = computed(() => this.text().normalize('NFC').trim().replace(/\s+/g, ' '));
  /** Tags the message does not carry yet, with words starting like the words typed. */
  protected readonly options = computed(() => {
    const carried = new Set(this.current().map((tag) => tag.id));
    const typed = this.typed();
    return this.store
      .tags()
      .filter((tag) => !carried.has(tag.id) && startsWords(tag.name, typed))
      .slice(0, MAX_OPTIONS);
  });
  /** The typed name, when no tag has it yet. */
  protected readonly newName = computed(() => {
    const name = this.typed();
    return name && !this.existing(name) ? name : null;
  });

  protected typing(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  /** Enter with no suggestion active: the tag with that name, or a new tag. */
  protected submit(event: MatChipInputEvent): void {
    if (this.trigger()?.activeOption) {
      // The active suggestion is chosen by the autocomplete itself.
      return;
    }
    const name = this.typed();
    if (name) {
      const existing = this.existing(name);
      this.add(existing ? { tagId: existing.id } : this.newTag(name));
    }
    event.chipInput.clear();
  }

  protected chosen(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as TagDto | typeof CREATE;
    const name = this.typed();
    if (value !== CREATE) {
      this.add({ tagId: value.id });
    } else if (name) {
      this.add(this.newTag(name));
    }
  }

  protected remove(tag: TagRefDto): void {
    this.run(this.api.untagMessage(this.messageId(), tag.id));
  }

  private existing(name: string): TagDto | undefined {
    return this.store.tags().find((tag) => tagKey(tag.name) === tagKey(name));
  }

  private newTag(name: string): AddMessageTagRequest {
    return { name, color: nextTagColor(this.store.tags()) };
  }

  private add(request: AddMessageTagRequest): void {
    this.text.set('');
    const field = this.field()?.nativeElement;
    if (field) {
      field.value = '';
    }
    this.run(this.api.tagMessage(this.messageId(), request));
  }

  private run(request: Observable<MessageTagsDto>): void {
    const id = this.messageId();
    this.busy.set(true);
    this.error.set(null);
    request
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ tags }) => {
          this.current.set(tags);
          this.changes.publish(tagsChanged(id, tags));
          // Counts changed, and maybe a new tag exists.
          this.store.reload();
        },
        error: (error: unknown) => this.error.set(toApiError(error).message),
      });
  }
}
