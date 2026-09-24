import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { ChannelDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { channelHandle, channelInitials, chatTypeLabel } from './channel-labels';

/** Summary card of one archived channel; the title links to the channel page. */
@Component({
  selector: 'app-channel-card',
  imports: [BytesPipe, DatePipe, DecimalPipe, MatIcon, RouterLink],
  templateUrl: './channel-card.html',
  styleUrl: './channel-card.scss',
})
export class ChannelCard {
  readonly channel = input.required<ChannelDto>();

  protected readonly initials = computed(() => channelInitials(this.channel().title));
  protected readonly handle = computed(() => channelHandle(this.channel()));
  protected readonly typeLabel = computed(() => chatTypeLabel(this.channel().type));
}
