import { PrismaClient, Sport, UserRole, AuthProvider } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Oracle database...');

  // ─── Create admin user ───
  const admin = await prisma.user.upsert({
    where: { email: 'admin@oracle.dev' },
    update: {},
    create: {
      email: 'admin@oracle.dev',
      firstName: 'Oracle',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      authProvider: AuthProvider.EMAIL,
      emailVerified: true,
      preferredSports: [Sport.FOOTBALL],
      passwordHash: '$2b$10$placeholder', // replace with real hash
    },
  });

  console.log(`  ✓ Admin user: ${admin.email}`);

  // ─── Seed sample leagues ───
  const leagues = [
    { externalId: '39', name: 'Premier League', country: 'England', countryCode: 'GB', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '140', name: 'La Liga', country: 'Spain', countryCode: 'ES', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '135', name: 'Serie A', country: 'Italy', countryCode: 'IT', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '78', name: 'Bundesliga', country: 'Germany', countryCode: 'DE', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '61', name: 'Ligue 1', country: 'France', countryCode: 'FR', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '2', name: 'Champions League', country: 'Europe', countryCode: 'EU', sport: Sport.FOOTBALL, season: 2025 },
    { externalId: '3', name: 'Europa League', country: 'Europe', countryCode: 'EU', sport: Sport.FOOTBALL, season: 2025 },
  ];

  for (const league of leagues) {
    await prisma.league.upsert({
      where: { externalId: league.externalId },
      update: {},
      create: league,
    });
  }

  console.log(`  ✓ ${leagues.length} leagues seeded`);

  // ─── Seed sample teams (Premier League) ───
  const teams = [
    { externalId: '33', name: 'Manchester United', shortName: 'Man Utd', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '34', name: 'Newcastle United', shortName: 'Newcastle', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '40', name: 'Liverpool', shortName: 'Liverpool', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '42', name: 'Arsenal', shortName: 'Arsenal', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '49', name: 'Chelsea', shortName: 'Chelsea', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '50', name: 'Manchester City', shortName: 'Man City', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '47', name: 'Tottenham', shortName: 'Spurs', country: 'England', sport: Sport.FOOTBALL },
    { externalId: '66', name: 'Aston Villa', shortName: 'Villa', country: 'England', sport: Sport.FOOTBALL },
  ];

  for (const team of teams) {
    await prisma.team.upsert({
      where: { externalId: team.externalId },
      update: {},
      create: team,
    });
  }

  console.log(`  ✓ ${teams.length} teams seeded`);
  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
