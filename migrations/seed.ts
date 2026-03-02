import pg from 'pg';

const CLUB_ID = '00000000-0000-0000-0000-000000000001';

const seasons = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'Fall 2022 - Spring 2023', start: '2022-08-15', end: '2023-05-31', current: false },
  { id: '00000000-0000-0000-0001-000000000002', name: 'Fall 2023 - Spring 2024', start: '2023-08-15', end: '2024-05-31', current: false },
  { id: '00000000-0000-0000-0001-000000000003', name: 'Fall 2024 - Spring 2025', start: '2024-08-15', end: '2025-05-31', current: false },
  { id: '00000000-0000-0000-0001-000000000004', name: 'Fall 2025 - Spring 2026', start: '2025-08-15', end: '2026-05-31', current: true },
];

const teams = [
  { idx: 1,  name: 'U8 Blue',    ageGroup: 'U8',  gender: 'M', level: 'rec',     tuition: 1200, coach: 'Mike Torres',   roster: 16 },
  { idx: 2,  name: 'U8 Red',     ageGroup: 'U8',  gender: 'F', level: 'rec',     tuition: 1200, coach: 'Sarah Chen',    roster: 14 },
  { idx: 3,  name: 'U10 Blue',   ageGroup: 'U10', gender: 'M', level: 'select',  tuition: 1400, coach: 'James Walker',  roster: 18 },
  { idx: 4,  name: 'U10 Red',    ageGroup: 'U10', gender: 'F', level: 'select',  tuition: 1400, coach: 'Lisa Park',     roster: 17 },
  { idx: 5,  name: 'U11 Blue',   ageGroup: 'U11', gender: 'M', level: 'select',  tuition: 1500, coach: "Ryan O'Brien",  roster: 20 },
  { idx: 6,  name: 'U11 Red',    ageGroup: 'U11', gender: 'F', level: 'select',  tuition: 1500, coach: 'Megan Diaz',    roster: 18 },
  { idx: 7,  name: 'U12 Blue',   ageGroup: 'U12', gender: 'M', level: 'select',  tuition: 1600, coach: 'David Kim',     roster: 22 },
  { idx: 8,  name: 'U12 Red',    ageGroup: 'U12', gender: 'F', level: 'select',  tuition: 1600, coach: 'Nicole Brown',  roster: 20 },
  { idx: 9,  name: 'U13 Select', ageGroup: 'U13', gender: 'M', level: 'premier', tuition: 1800, coach: 'Carlos Ruiz',   roster: 20 },
  { idx: 10, name: 'U13 Red',    ageGroup: 'U13', gender: 'F', level: 'select',  tuition: 1700, coach: 'Amy Johnson',   roster: 18 },
  { idx: 11, name: 'U14 Select', ageGroup: 'U14', gender: 'M', level: 'premier', tuition: 2000, coach: 'Tom Nguyen',    roster: 22 },
  { idx: 12, name: 'U14 Red',    ageGroup: 'U14', gender: 'F', level: 'premier', tuition: 1900, coach: 'Kate Williams', roster: 20 },
  { idx: 13, name: 'U15 Select', ageGroup: 'U15', gender: 'M', level: 'premier', tuition: 2200, coach: 'Greg Martin',   roster: 20 },
  { idx: 14, name: 'U15 Red',    ageGroup: 'U15', gender: 'F', level: 'select',  tuition: 2000, coach: 'Rachel Adams',  roster: 18 },
  { idx: 15, name: 'U16 Elite',  ageGroup: 'U16', gender: 'M', level: 'premier', tuition: 2400, coach: 'Marco Vasquez', roster: 18 },
  { idx: 16, name: 'U17 Elite',  ageGroup: 'U17', gender: 'M', level: 'premier', tuition: 2500, coach: 'Steve Hoffman', roster: 16 },
  { idx: 17, name: 'U18 Elite',  ageGroup: 'U18', gender: 'M', level: 'premier', tuition: 2600, coach: 'Jason Lee',     roster: 16 },
  { idx: 18, name: 'U19 Elite',  ageGroup: 'U19', gender: 'M', level: 'premier', tuition: 2600, coach: 'Brian Clark',   roster: 14 },
];

// Retention rates by age group for the current season (Fall 2025)
const retentionByAge: Record<string, { rate: number; graduated: number }> = {
  U8:  { rate: 0.68, graduated: 0 },
  U10: { rate: 0.81, graduated: 0 },
  U11: { rate: 0.79, graduated: 0 },
  U12: { rate: 0.72, graduated: 0 },
  U13: { rate: 0.63, graduated: 0 },
  U14: { rate: 0.71, graduated: 3 },
  U15: { rate: 0.76, graduated: 5 },
  U16: { rate: 0.82, graduated: 0 },
  U17: { rate: 0.85, graduated: 0 },
  U18: { rate: 0.78, graduated: 2 },
  U19: { rate: 0.00, graduated: 14 },
};

const firstNames = ['James','John','Robert','Michael','David','William','Richard','Joseph','Thomas','Christopher','Daniel','Matthew','Anthony','Mark','Steven','Andrew','Joshua','Kevin','Brian','Ryan','Emma','Olivia','Ava','Sophia','Isabella','Mia','Charlotte','Amelia','Harper','Evelyn','Abigail','Emily','Elizabeth','Sofia','Avery','Ella','Scarlett','Grace','Lily','Chloe'];
const lastNames = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson'];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function birthYearForAge(ageGroup: string): number {
  const age = parseInt(ageGroup.replace('U', ''), 10);
  return 2025 - age + 1; // e.g., U13 → born 2013
}

async function seed() {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://clubiq:clubiq_dev@localhost:5432/clubiq';
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check if already seeded
    const { rows: existing } = await client.query('SELECT id FROM clubs WHERE id = $1', [CLUB_ID]);
    if (existing.length > 0) {
      console.log('Mountain View FC already exists. To re-seed, delete the club first.');
      return;
    }

    await client.query('BEGIN');

    // 1. Create club
    await client.query(
      'INSERT INTO clubs (id, name, subdomain, state) VALUES ($1, $2, $3, $4)',
      [CLUB_ID, 'Mountain View FC', 'mountainviewfc', 'UT']
    );
    console.log('  Created club: Mountain View FC');

    // 2. Create seasons
    for (const s of seasons) {
      await client.query(
        'INSERT INTO seasons (id, club_id, name, start_date, end_date, is_current) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, CLUB_ID, s.name, s.start, s.end, s.current]
      );
    }
    console.log(`  Created ${seasons.length} seasons`);

    // 3. Create teams for current season
    const currentSeasonId = seasons[3].id;
    const prevSeasonId = seasons[2].id;
    const teamUuids: Record<number, string> = {};

    for (const t of teams) {
      const teamId = `00000000-0000-0000-0002-${String(t.idx).padStart(12, '0')}`;
      teamUuids[t.idx] = teamId;
      await client.query(
        'INSERT INTO teams (id, club_id, season_id, name, age_group, gender, competitive_level, tuition_amount, coach_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [teamId, CLUB_ID, currentSeasonId, t.name, t.ageGroup, t.gender, t.level, t.tuition * 100, t.coach]
      );
    }
    console.log(`  Created ${teams.length} teams`);

    // Also create teams for previous season (same structure, different season_id)
    const prevTeamUuids: Record<number, string> = {};
    for (const t of teams) {
      const teamId = `00000000-0000-0000-0003-${String(t.idx).padStart(12, '0')}`;
      prevTeamUuids[t.idx] = teamId;
      await client.query(
        'INSERT INTO teams (id, club_id, season_id, name, age_group, gender, competitive_level, tuition_amount, coach_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [teamId, CLUB_ID, prevSeasonId, t.name, t.ageGroup, t.gender, t.level, t.tuition * 100, t.coach]
      );
    }
    console.log(`  Created ${teams.length} previous-season teams`);

    // 4. Create players and assign to seasons
    let playerCount = 0;
    let paymentCount = 0;

    for (const t of teams) {
      const retention = retentionByAge[t.ageGroup];
      const returningCount = Math.round(t.roster * retention.rate);
      const newCount = t.roster - returningCount;

      // Create returning players (exist in both prev and current season)
      for (let i = 0; i < returningCount; i++) {
        const playerId = `00000000-0000-0000-1000-${String(playerCount + 1).padStart(12, '0')}`;
        const gender = t.gender === 'Coed' ? (Math.random() > 0.5 ? 'M' : 'F') : t.gender;
        const birthYear = birthYearForAge(t.ageGroup) + Math.floor(Math.random() * 2);

        await client.query(
          'INSERT INTO players (id, club_id, external_id, first_name, last_name, birth_year, gender) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [playerId, CLUB_ID, `PLR-${playerCount + 1}`, randomFrom(firstNames), randomFrom(lastNames), birthYear, gender]
        );

        // Previous season enrollment
        await client.query(
          'INSERT INTO player_seasons (player_id, season_id, team_id, status) VALUES ($1, $2, $3, $4)',
          [playerId, prevSeasonId, prevTeamUuids[t.idx], 'active']
        );

        // Current season enrollment
        await client.query(
          'INSERT INTO player_seasons (player_id, season_id, team_id, status) VALUES ($1, $2, $3, $4)',
          [playerId, currentSeasonId, teamUuids[t.idx], 'active']
        );

        // Payment for current season
        await client.query(
          'INSERT INTO payments (club_id, player_id, season_id, amount, type, paid_date, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [CLUB_ID, playerId, currentSeasonId, t.tuition * 100, 'tuition', '2025-08-01', 'paid']
        );
        paymentCount++;

        playerCount++;
      }

      // Create new players (only in current season)
      for (let i = 0; i < newCount; i++) {
        const playerId = `00000000-0000-0000-1000-${String(playerCount + 1).padStart(12, '0')}`;
        const gender = t.gender === 'Coed' ? (Math.random() > 0.5 ? 'M' : 'F') : t.gender;
        const birthYear = birthYearForAge(t.ageGroup) + Math.floor(Math.random() * 2);

        await client.query(
          'INSERT INTO players (id, club_id, external_id, first_name, last_name, birth_year, gender) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [playerId, CLUB_ID, `PLR-${playerCount + 1}`, randomFrom(firstNames), randomFrom(lastNames), birthYear, gender]
        );

        // Current season only
        await client.query(
          'INSERT INTO player_seasons (player_id, season_id, team_id, status) VALUES ($1, $2, $3, $4)',
          [playerId, currentSeasonId, teamUuids[t.idx], 'active']
        );

        // Payment
        await client.query(
          'INSERT INTO payments (club_id, player_id, season_id, amount, type, paid_date, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [CLUB_ID, playerId, currentSeasonId, t.tuition * 100, 'tuition', '2025-08-01', 'paid']
        );
        paymentCount++;

        playerCount++;
      }

      // Create churned players (prev season only, not returning)
      const churnedCount = Math.round(t.roster * (1 - retention.rate)) - retention.graduated;
      for (let i = 0; i < Math.max(0, churnedCount); i++) {
        const playerId = `00000000-0000-0000-1000-${String(playerCount + 1).padStart(12, '0')}`;
        const gender = t.gender === 'Coed' ? (Math.random() > 0.5 ? 'M' : 'F') : t.gender;
        const birthYear = birthYearForAge(t.ageGroup) + Math.floor(Math.random() * 2);

        await client.query(
          'INSERT INTO players (id, club_id, external_id, first_name, last_name, birth_year, gender) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [playerId, CLUB_ID, `PLR-${playerCount + 1}`, randomFrom(firstNames), randomFrom(lastNames), birthYear, gender]
        );

        // Previous season only — churned
        await client.query(
          'INSERT INTO player_seasons (player_id, season_id, team_id, status) VALUES ($1, $2, $3, $4)',
          [playerId, prevSeasonId, prevTeamUuids[t.idx], 'churned']
        );

        playerCount++;
      }

      // Create graduated players (prev season only)
      for (let i = 0; i < retention.graduated; i++) {
        const playerId = `00000000-0000-0000-1000-${String(playerCount + 1).padStart(12, '0')}`;
        const gender = t.gender === 'Coed' ? (Math.random() > 0.5 ? 'M' : 'F') : t.gender;
        const birthYear = birthYearForAge(t.ageGroup) + Math.floor(Math.random() * 2);

        await client.query(
          'INSERT INTO players (id, club_id, external_id, first_name, last_name, birth_year, gender) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [playerId, CLUB_ID, `PLR-${playerCount + 1}`, randomFrom(firstNames), randomFrom(lastNames), birthYear, gender]
        );

        // Previous season only — graduated
        await client.query(
          'INSERT INTO player_seasons (player_id, season_id, team_id, status) VALUES ($1, $2, $3, $4)',
          [playerId, prevSeasonId, prevTeamUuids[t.idx], 'graduated']
        );

        playerCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`\nSeed complete:`);
    console.log(`  Club: Mountain View FC (${CLUB_ID})`);
    console.log(`  Seasons: ${seasons.length}`);
    console.log(`  Teams: ${teams.length * 2} (current + previous season)`);
    console.log(`  Players: ${playerCount}`);
    console.log(`  Payments: ${paymentCount}`);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
