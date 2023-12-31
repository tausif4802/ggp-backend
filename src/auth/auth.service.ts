import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Client } from 'src/clients/clients.entity';
import { ClientsService } from 'src/clients/clients.service';
import { SocialLoginDto } from 'src/clients/dto/social-login.dto';
import { User } from 'src/users/users.entity';
import { UsersService } from 'src/users/users.service';
import { PasswordStrategy } from 'src/utils/auth/strategy/password.strategy';
import { jwtConfig } from 'src/utils/configs/jwt.config';
import { errorhandler, successHandler } from 'src/utils/response.handler';
import { Repository } from 'typeorm';
import { LoginUserDto } from './dto/login-user.dto';
import { SignUpUserDto } from './dto/signup-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private clientService: ClientsService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Client) private clientRepo: Repository<Client>,
    private jwtService: JwtService,
    private passwordStrategy: PasswordStrategy,
  ) {}

  async getTokens(userId: string, email: string, role: string) {
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, role },
        { secret: jwtConfig.secret, expiresIn: jwtConfig.expires_in },
      ),
      this.jwtService.signAsync(
        { sub: userId, email, role },
        {
          secret: jwtConfig.REFRESH_TOKEN_SECRET,
          expiresIn: jwtConfig.REFRESH_TOKEN_EXPIRATION,
        },
      ),
    ]);

    return {
      access_token: access_token,
      refresh_token: refresh_token,
    };
  }

  async signUp(signupUserDto: SignUpUserDto) {
    const user = await this.usersService.findUserByEmail(signupUserDto.email);
    if (user.length) {
      throw new BadRequestException('User with this email already exists');
    }

    let newUser;
    try {
      const encPassword = await this.passwordStrategy.hashPassword(
        signupUserDto.password,
      );
      newUser = this.userRepo.create({
        ...signupUserDto,
        password: encPassword,
      });
      await this.userRepo.save(newUser);
    } catch (error) {
      return error;
    }

    return successHandler('User created successfully', {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    });
  }

  async login(loginInfo: LoginUserDto) {
    const [userInfo] = await this.usersService.findUserByEmail(loginInfo.email);
    if (!userInfo) {
      throw new NotFoundException('User with this email does not exist');
    }
    if (userInfo.status === 'inactive') {
      throw new BadRequestException('Account Restricted!');
    }
    const isPasswordValid = await bcrypt.compare(
      loginInfo.password,
      userInfo.password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid password');
    }
    const tokens = await this.getTokens(
      userInfo.id,
      userInfo.email,
      userInfo.role,
    );

    return successHandler('Login successful', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: {
        id: userInfo.id,
        name: userInfo.name,
        email: userInfo.email,
        role: userInfo.role,
      },
    });
  }

  async refreshTokens(res: any, req: any, token: string) {
    try {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      const decodedJwtRefreshToken: any = this.jwtService.decode(token);
      if (!decodedJwtRefreshToken) {
        throw new ForbiddenException('Access Denied');
      }
      const expires = decodedJwtRefreshToken.exp;
      if (expires < new Date().getTime() / 1000) {
        throw new ForbiddenException('Access Denied');
      }
      const userInfo = await this.userRepo.findOneBy({
        id: decodedJwtRefreshToken.sub,
      });
      if (!userInfo) {
        throw new ForbiddenException('Access Denied');
      }

      const tokens = await this.getTokens(
        userInfo.id,
        userInfo.email,
        userInfo.role,
      );
      return successHandler('Login successful', {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        user: {
          id: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
          role: userInfo.role,
        },
      });
    } catch (error) {
      return new BadRequestException(error);
    }
  }

  async logout(req: any, res: any) {
    try {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      res.clearCookie('refreshToken', {
        sameSite: 'none',
        httpOnly: true,
        secure: false,
      });
      return 'Logged out!';
    } catch (err) {
      return new BadRequestException(err);
    }
  }

  async socialLogin(req: any, socialLoginDto: SocialLoginDto, res: any) {
    try {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      const userInfo = await this.clientService.findClientByEmail(
        socialLoginDto.email,
      );
      if (!userInfo) {
        const fullname =
          socialLoginDto.firstName + ' ' + socialLoginDto.lastName;
        const result = this.clientRepo.create({
          name: fullname,
          email: socialLoginDto.email,
          role: 'client',
        });
        const user = await this.clientRepo.save(result);

        const tokens = await this.getTokens(user.id, user.email, user.role);
        res.cookie('refreshToken', tokens.refresh_token, {
          expires: new Date(new Date().setDate(new Date().getDate() + 7)),
          sameSite: 'none',
          httpOnly: true,
          secure: true,
        });
        return successHandler('Authenticated!', {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: 'Bearer',
          user_profile: {
            fullname: user.name,
            email: user.email,
            role: user.role,
          },
        });
      } else {
        const tokens = await this.getTokens(
          userInfo.id,
          userInfo.email,
          userInfo.role,
        );
        res.cookie('refreshToken', tokens.refresh_token, {
          expires: new Date(new Date().setDate(new Date().getDate() + 7)),
          sameSite: 'none',
          httpOnly: true,
          secure: true,
        });
        return successHandler('Authenticated!', {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: 'Bearer',
          user_profile: {
            fullname: userInfo.name,
            email: userInfo.email,
            role: userInfo.role,
          },
        });
      }
    } catch (error) {
      return errorhandler(400, JSON.stringify(error.message));
    }
  }
}
