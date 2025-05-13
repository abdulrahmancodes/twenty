import { Injectable } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { InjectObjectMetadataRepository } from 'src/engine/object-metadata-repository/object-metadata-repository.decorator';
import { WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { WorkspaceDataSourceService } from 'src/engine/workspace-datasource/workspace-datasource.service';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

@Injectable()
@Resolver(() => TimelineActivityWorkspaceEntity)
export class TimelineActivityResolver {
  constructor(
    @InjectObjectMetadataRepository(TimelineActivityWorkspaceEntity)
    private readonly timelineActivityRepository: WorkspaceRepository<TimelineActivityWorkspaceEntity>,
    @InjectRepository(FieldMetadataEntity, 'metadata')
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectRepository(ObjectMetadataEntity, 'metadata')
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly workspaceDataSourceService: WorkspaceDataSourceService,
  ) {}

  @Query(() => [TimelineActivityWorkspaceEntity])
  async findCascadingTimelineActivities(
    @Args('objectNameSingular') objectNameSingular: string,
    @Args('recordId') recordId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('depth', { nullable: true, defaultValue: 1 }) depth: number,
  ) {
    const objectMetadata = await this.objectMetadataRepository.findOne({
      where: {
        nameSingular: objectNameSingular,
        workspaceId,
      },
    });

    if (!objectMetadata) {
      throw new Error(`Object metadata not found for ${objectNameSingular}`);
    }

    const rollupFields = await this.fieldMetadataRepository.find({
      where: {
        objectMetadataId: objectMetadata.id,
        isTimelineRollupEnabled: true,
      },
      relations: [
        'fromRelationMetadata',
        'fromRelationMetadata.toObjectMetadata',
      ],
    });

    const directActivities = await this.timelineActivityRepository.find({
      where: {
        linkedObjectMetadataId: objectMetadata.id,
        linkedRecordId: recordId,
        deletedAt: IsNull(),
      },
      order: {
        happensAt: 'DESC',
      },
    });

    if (depth === 0 || rollupFields.length === 0) {
      return directActivities;
    }

    const relatedActivities = await this.getRelatedActivities(
      objectMetadata.id,
      recordId,
      rollupFields,
      depth,
      workspaceId,
    );

    return [...directActivities, ...relatedActivities].sort(
      (a, b) =>
        new Date(b.happensAt).getTime() - new Date(a.happensAt).getTime(),
    );
  }

  private async getRelatedActivities(
    objectMetadataId: string,
    recordId: string,
    rollupFields: FieldMetadataEntity[],
    depth: number,
    workspaceId: string,
  ): Promise<TimelineActivityWorkspaceEntity[]> {
    if (depth <= 0) {
      return [];
    }

    const relatedActivities: TimelineActivityWorkspaceEntity[] = [];

    for (const field of rollupFields) {
      const relation = field.fromRelationMetadata;

      if (!relation) continue;

      const targetObject = relation.toObjectMetadata;

      if (!targetObject) continue;

      const relatedRecords =
        await this.workspaceDataSourceService.executeRawQuery(
          `SELECT "id" FROM "${targetObject.nameSingular}" WHERE "${field.name}Id" = $1 AND "deletedAt" IS NULL`,
          [recordId],
          workspaceId,
        );

      for (const record of relatedRecords) {
        const activities = await this.timelineActivityRepository.find({
          where: {
            linkedObjectMetadataId: targetObject.id,
            linkedRecordId: record.id,
            deletedAt: IsNull(),
          },
          order: {
            happensAt: 'DESC',
          },
        });

        relatedActivities.push(...activities);

        if (depth > 1) {
          const nestedActivities = await this.getRelatedActivities(
            targetObject.id,
            record.id,
            rollupFields,
            depth - 1,
            workspaceId,
          );

          relatedActivities.push(...nestedActivities);
        }
      }
    }

    return relatedActivities;
  }
}
