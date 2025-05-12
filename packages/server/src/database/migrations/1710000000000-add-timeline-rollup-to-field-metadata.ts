import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimelineRollupToFieldMetadata1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "fieldMetadata" 
      ADD COLUMN "isTimelineRollupEnabled" boolean NOT NULL DEFAULT false;
    `);

    // Update existing relation fields to have timeline rollup enabled by default
    await queryRunner.query(`
      UPDATE "fieldMetadata"
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
      ALTER TABLE "fieldMetadata" 
      DROP COLUMN "isTimelineRollupEnabled";
    `);
  }
} 