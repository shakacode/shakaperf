import type { TestPair } from '../types';

export class Test {
  pair: TestPair;
  status: string;

  constructor (pair: TestPair) {
    this.pair = pair;
    this.status = 'running';
  }

  passed () {
    return this.status === 'pass';
  }
}

class Reporter {
  testSuite: string;
  tests: Test[];
  id?: string;

  constructor (testSuite: string) {
    this.testSuite = testSuite;
    this.tests = [];
  }

  addTest (pair: TestPair) {
    const t = new Test(pair);
    this.tests.push(t);
    return t;
  }

  passed () {
    return this.tests.filter(test => test.passed()).length;
  }

  failed () {
    return this.tests.filter(test => !test.passed()).length;
  }

  getReport () {
    return {
      testSuite: this.testSuite,
      tests: this.tests
    };
  }
}

export default Reporter;
