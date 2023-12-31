import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './clients.entity';
import { SocialLoginDto } from './dto/social-login.dto';
import { errorhandler, successHandler } from 'src/utils/response.handler';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private clientRepo: Repository<Client>,
  ) {}

  async createClient(socialLoginDto: SocialLoginDto) {
    try {
      const client = this.clientRepo.create({
        ...socialLoginDto,
        role: 'client',
      });
      await this.clientRepo.save(client);
      return successHandler('Client created successfully', {
        id: client.id,
        name: client.name,
        email: client.email,
        role: client.role,
      });
    } catch (error) {
      errorhandler(500, error.message);
    }
  }

  async findClientByEmail(email: string) {
    const user = await this.clientRepo.findBy({ email: email });
    return user[0];
  }

  async findClientById(id: string) {
    try {
      const client = await this.clientRepo.findBy({ id: id });
      return successHandler('Client found successfully', client);
    } catch (error) {
      errorhandler(500, error.message);
    }
  }
}
