import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { type TagDto, toApiError } from '../../shared/models';
import { MessageChanges, tagDeleted, tagEdited } from '../messages/message-changes';
import { openTagDialog } from './tag-dialog';
import { TagStore } from './tag-store';
import { TagsApi } from './tags-api';

export function messageCount(count: number): string {
  return count === 1 ? '1 message' : `${count.toLocaleString()} messages`;
}

/** Creating, editing and deleting tags, the same way from every page. */
@Injectable({ providedIn: 'root' })
export class TagActions {
  private readonly dialog = inject(MatDialog);
  private readonly api = inject(TagsApi);
  private readonly store = inject(TagStore);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);
  private readonly changes = inject(MessageChanges);

  /** The new tag, or undefined when cancelled. */
  async create(): Promise<TagDto | undefined> {
    return firstValueFrom(openTagDialog(this.dialog));
  }

  /** Renames or recolors a tag; the messages on screen follow. */
  async edit(tag: TagDto): Promise<TagDto | undefined> {
    const saved = await firstValueFrom(openTagDialog(this.dialog, tag));
    if (saved) {
      this.changes.publish(tagEdited({ id: saved.id, name: saved.name, color: saved.color }));
    }
    return saved;
  }

  /** Deletes a tag after asking; true once it is gone. */
  async remove(tag: TagDto): Promise<boolean> {
    const confirmed = await this.confirm.ask({
      title: `Delete the tag “${tag.name}”?`,
      message:
        tag.messageCount > 0
          ? `It is taken off the ${messageCount(tag.messageCount)} that carry it. The messages stay in the archive.`
          : 'No message carries it.',
      confirmLabel: 'Delete tag',
      destructive: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      await firstValueFrom(this.api.remove(tag.id));
    } catch (error) {
      this.notify.error(`The tag could not be deleted: ${toApiError(error).message}`);
      return false;
    }
    this.changes.publish(tagDeleted(tag.id));
    this.store.reload();
    this.notify.success(`The tag “${tag.name}” was deleted.`);
    return true;
  }
}
