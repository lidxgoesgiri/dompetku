import 'dotenv/config';
import { databaseConfig } from './src/config/database.js';
const configurations = {};
for (const name of ['development', 'test', 'production']) {
  Object.defineProperty(configurations, name, {
    enumerable: true,
    get() {
      return databaseConfig(process.env);
    },
  });
}
export default configurations;
