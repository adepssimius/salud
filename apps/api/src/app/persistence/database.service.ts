import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CONNECTION_TOKEN,
  DatabaseConnection,
} from './database.providers';

@Injectable()
export class DatabaseService {
  constructor(
    @Inject(DATABASE_CONNECTION_TOKEN)
    private readonly connection: DatabaseConnection,
  ) {}

  get client() {
    return this.connection.client;
  }

  get db() {
    return this.connection.db;
  }
}
