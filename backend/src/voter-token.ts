import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { config } from './config';

export interface VoterTokenPayload {
  codeId: string;
  scrutinyId: string;
  electionId: string;
}

@Injectable()
export class VoterTokenService {
  sign(payload: VoterTokenPayload) {
    return jwt.sign(payload, config.VOTER_JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
      subject: payload.codeId
    });
  }

  verify(token: string): VoterTokenPayload {
    try {
      const payload = jwt.verify(token, config.VOTER_JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof payload === 'string') throw new Error('Invalid payload');
      return {
        codeId: String(payload.codeId),
        scrutinyId: String(payload.scrutinyId),
        electionId: String(payload.electionId)
      };
    } catch {
      throw new UnauthorizedException('Acesso à votação expirado. Digite sua senha novamente.');
    }
  }
}
