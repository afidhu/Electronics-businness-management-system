import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { BranchScopeGuard } from '../access/branch-scope.guard';
import { AppConfigService } from '../config/app-config.service';
import { AuthUserLoader } from './auth-user.loader';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [
    // Secret/expiry are passed per call from validated config (TokenService).
    JwtModule.register({}),
    // Login rate limiting per client IP (in-memory; single API instance, ADR-018).
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            // 'default' yields standard Retry-After / X-RateLimit-* headers.
            // Only applied where ThrottlerGuard is used (POST /auth/login).
            name: 'default',
            limit: config.loginRateLimit.limit,
            ttl: seconds(config.loginRateLimit.windowSeconds),
          },
        ],
        errorMessage: 'Too many login attempts. Try again later.',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    AuthUserLoader,
    CsrfGuard,
    // Global guards run in this order: authenticate → authorise → branch scope.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
  ],
  exports: [PasswordService, RefreshTokenService],
})
export class AuthModule {}
