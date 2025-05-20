import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SearchPageInfoDTO {
  @Field(() => String)
  endCursor: string;

  @Field(() => Boolean)
  hasNextPage: boolean;
}
