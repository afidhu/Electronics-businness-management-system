import { Global, Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service';
import { RolesController } from './roles.controller';

@Global()
@Module({
  controllers: [RolesController],
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class AccessModule {}
