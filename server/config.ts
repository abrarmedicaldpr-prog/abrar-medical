import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'ams_medical.db'),
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  appTimezoneOffset: '+05:00',
  appCurrency: process.env.APP_CURRENCY || 'PKR',
  appCurrencySymbol: 'Rs.',
  appLocale: process.env.APP_LOCALE || 'en-PK',
  companyName: process.env.COMPANY_NAME || 'Abrar Medical Store',
  country: 'Pakistan',
};
