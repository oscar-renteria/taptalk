import { test } from 'node:test';
import { verifyDeploymentConfig } from './verify-deployment-config.mjs';

test('production container and proxy configuration satisfies the deployment contract', () => {
  verifyDeploymentConfig();
});
