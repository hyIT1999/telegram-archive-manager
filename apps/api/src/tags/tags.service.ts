import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  type AddMessageTagRequest,
  ApiErrorCode,
  type CreateTagRequest,
  MAX_TAGS,
  type MessageTagsDto,
  type TagDto,
  TagErrorCode,
  type TagListDto,
  type UpdateTagRequest,
  normalizeTagName,
} from '@tam/shared';
import { messageNotFound } from '../messages/message-lookups.js';
import { MESSAGE_TAGS_INCLUDE, TAG_WITH_COUNT, toTagDto, toTagRefDto } from './tag.mapper.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isMissingRecord(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function tagNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Tag not found', code: ApiErrorCode.NOT_FOUND });
}

function nameTaken(name: string): ConflictException {
  return new ConflictException({
    message: `There is already a tag named “${name}”`,
    code: TagErrorCode.TAG_NAME_TAKEN,
  });
}

/**
 * Tags and the messages that carry them. Names are unique without regard to case; a tag named
 * while tagging a message is created on the way.
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every tag (there are at most MAX_TAGS), by name. */
  async list(): Promise<TagListDto> {
    const tags = await this.prisma.tag.findMany({
      orderBy: { nameNormalized: 'asc' },
      include: TAG_WITH_COUNT,
    });
    return { items: tags.map(toTagDto) };
  }

  async create(request: CreateTagRequest): Promise<TagDto> {
    await this.ensureRoom();
    try {
      const tag = await this.prisma.tag.create({
        data: {
          name: request.name,
          nameNormalized: normalizeTagName(request.name),
          color: request.color ?? null,
        },
        include: TAG_WITH_COUNT,
      });
      return toTagDto(tag);
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(request.name) : error;
    }
  }

  /** Renames or recolors a tag; its messages keep it. */
  async update(id: string, request: UpdateTagRequest): Promise<TagDto> {
    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data: {
          ...(request.name === undefined
            ? {}
            : { name: request.name, nameNormalized: normalizeTagName(request.name) }),
          ...(request.color === undefined ? {} : { color: request.color }),
        },
        include: TAG_WITH_COUNT,
      });
      return toTagDto(tag);
    } catch (error) {
      if (isMissingRecord(error)) {
        throw tagNotFound();
      }
      throw isUniqueViolation(error) ? nameTaken(request.name ?? '') : error;
    }
  }

  /** Deletes a tag; the messages that carried it simply lose it. */
  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.tag.deleteMany({ where: { id } });
    if (count === 0) {
      throw tagNotFound();
    }
  }

  /** Tags a message with an existing tag, or with a name (creating the tag if it is new). */
  async tagMessage(messageId: string, request: AddMessageTagRequest): Promise<MessageTagsDto> {
    await this.requireMessage(messageId);
    const tagId =
      'tagId' in request
        ? await this.requireTag(request.tagId)
        : await this.tagNamed(request.name, request.color ?? null);
    await this.prisma.messageTag.createMany({
      data: [{ messageId, tagId }],
      skipDuplicates: true,
    });
    return this.tagsOf(messageId);
  }

  /** Takes a tag off a message; a tag it does not carry changes nothing. */
  async untagMessage(messageId: string, tagId: string): Promise<MessageTagsDto> {
    await this.requireMessage(messageId);
    await this.prisma.messageTag.deleteMany({ where: { messageId, tagId } });
    return this.tagsOf(messageId);
  }

  private async tagsOf(messageId: string): Promise<MessageTagsDto> {
    const rows = await this.prisma.messageTag.findMany({
      where: { messageId },
      ...MESSAGE_TAGS_INCLUDE,
    });
    return { tags: rows.map((row) => toTagRefDto(row.tag)) };
  }

  /** The tag with this name (compared without regard to case), created if there is none. */
  private async tagNamed(name: string, color: string | null): Promise<string> {
    const nameNormalized = normalizeTagName(name);
    const existing = await this.prisma.tag.findUnique({
      where: { nameNormalized },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }
    await this.ensureRoom();
    try {
      const tag = await this.prisma.tag.create({
        data: { name, nameNormalized, color },
        select: { id: true },
      });
      return tag.id;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Created by another request in the meantime.
      const created = await this.prisma.tag.findUniqueOrThrow({
        where: { nameNormalized },
        select: { id: true },
      });
      return created.id;
    }
  }

  private async ensureRoom(): Promise<void> {
    if ((await this.prisma.tag.count()) >= MAX_TAGS) {
      throw new UnprocessableEntityException({
        message: `The archive already has ${MAX_TAGS} tags. Delete some before adding more.`,
        code: TagErrorCode.TAG_LIMIT_REACHED,
      });
    }
  }

  private async requireMessage(id: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id }, select: { id: true } });
    if (!message) {
      throw messageNotFound();
    }
  }

  private async requireTag(id: string): Promise<string> {
    const tag = await this.prisma.tag.findUnique({ where: { id }, select: { id: true } });
    if (!tag) {
      throw tagNotFound();
    }
    return tag.id;
  }
}
