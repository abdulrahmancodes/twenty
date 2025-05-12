import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimelineRollupToFieldMetadata1710000000000
  implements MigrationInterface
{
  name = 'AddTimelineRollupToFieldMetadata1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "metadata"."fieldMetadata" 
      ADD COLUMN "isTimelineRollupEnabled" boolean NOT NULL DEFAULT false;
    `);

    // Update existing relation fields to have timeline rollup enabled by default
    await queryRunner.query(`
      UPDATE "metadata"."fieldMetadata"
      SET "isTimelineRollupEnabled" = true
      WHERE type = 'RELATION'
      AND name IN (
        'company', -- Person -> Company
        'person',  -- Company -> Person
        'opportunity' -- Company -> Opportunity
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "metadata"."fieldMetadata" 
      DROP COLUMN "isTimelineRollupEnabled";
    `);
  }
}
