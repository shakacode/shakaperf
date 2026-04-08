const { execSync } = require('child_process');
execSync('yarn build', { stdio: 'inherit' });
execSync('yarn node -e "' +
  "const { generateTimelineComparison } = require('./dist/core/timeline-comparison');" +
  "generateTimelineComparison({" +
  "  controlProfilePath: '../../integration-tests/snapshots/bench-results/visits-the-homepage/localhost_3020____performance_profile.json'," +
  "  experimentProfilePath: '../../integration-tests/snapshots/bench-results/visits-the-homepage/localhost_3030____performance_profile.json'," +
  "  outputPath: '/tmp/timeline_comparison.html'," +
  "});" +
  "console.log('Done: /tmp/timeline_comparison.html');" +
  '"', { stdio: 'inherit' });
