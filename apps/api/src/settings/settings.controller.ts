import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  type SettingsDto,
  type UpdateSettingsRequest,
  updateSettingsRequestSchema,
} from '@tam/shared';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<SettingsDto> {
    return this.settings.get();
  }

  /** Changes the given download and sync settings; downloads apply to waiting files at once. */
  @Patch()
  update(
    @Body({ schema: updateSettingsRequestSchema }) request: UpdateSettingsRequest,
  ): Promise<SettingsDto> {
    return this.settings.update(request);
  }
}
