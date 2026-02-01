import { evalite } from 'evalite';
import {
  loadSkillFixtures,
  runFixtureTask,
  PresenceScorer,
  AccuracyScorer,
} from '../src/eval/index.js';

const fixtures = loadSkillFixtures('sql-injection');

evalite('sql-injection', {
  data: fixtures.map((f) => ({
    input: f,
    expected: f.fixture.expectedBugs,
  })),
  task: runFixtureTask,
  scorers: [PresenceScorer, AccuracyScorer],
});
