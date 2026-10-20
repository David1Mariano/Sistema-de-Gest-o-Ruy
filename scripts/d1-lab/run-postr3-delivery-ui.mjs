import fs from 'node:fs/promises';
import {runStage4} from './test-integration-stage4.mjs';
import {createInstallationFixture} from './installation-fixture.mjs';
if(process.env.RUY_D1_INSTALLATION!=='i5r4-dev-20261020'||process.env.RUY_D1_DELIVERY_UI!=='1')throw Error('Explicit new development UI test required');
await fs.writeFile('logs/i5r4-dev/delivery-ui.json',JSON.stringify(await runStage4({fixtureFactory:createInstallationFixture}),null,2));
