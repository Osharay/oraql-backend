import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export type Sentiment = 'POSITIVE' | 'NEGATIVE';

/** What people tell us about OraQL, from the feedback button on every page. */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { sentiment: Sentiment; message?: string | null; email?: string | null; page?: string | null; userAgent?: string | null }) {
    const clip = (v: string | null | undefined, n: number) => {
      const t = (v ?? '').trim();
      return t ? t.slice(0, n) : null;
    };
    const email = clip(input.email, 200)?.toLowerCase() ?? null;
    const user = email ? await this.prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
    await this.prisma.feedback.create({
      data: {
        sentiment: input.sentiment,
        message: clip(input.message, 2000),
        email,
        userId: user?.id ?? null,
        page: clip(input.page, 300),
        userAgent: clip(input.userAgent, 300),
      },
    });
    return { ok: true };
  }

  async list(limit = 100) {
    const [items, positive, negative] = await Promise.all([
      this.prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) }),
      this.prisma.feedback.count({ where: { sentiment: 'POSITIVE' } }),
      this.prisma.feedback.count({ where: { sentiment: 'NEGATIVE' } }),
    ]);
    return { items, counts: { positive, negative } };
  }
}
