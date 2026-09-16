import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { config } from './config';

export type AdminRequest = Request & { adminId?: string };

export const AdminActor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<AdminRequest>().adminId || 'unknown-admin';
});

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (config.AUTH_DEV_BYPASS && request.header('x-dev-admin') === 'true') {
      request.adminId = 'local-admin';
      return true;
    }

    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Faça login para continuar.');

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Sessão administrativa inválida.');
    const allowedEmails = config.ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const email = data.user.email?.toLowerCase();
    if (!email || !allowedEmails.includes(email)) {
      throw new ForbiddenException('Esta conta não possui acesso administrativo.');
    }
    request.adminId = data.user.id;
    return true;
  }
}
