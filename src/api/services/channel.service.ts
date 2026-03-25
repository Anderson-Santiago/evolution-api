import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service';
import { DifyService } from '@api/integrations/chatbot/dify/services/dify.service';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { TypebotService } from '@api/integrations/chatbot/typebot/services/typebot.service';
import { PrismaRepository, Query } from '@api/repository/repository.service';
import { eventManager, waMonitor } from '@api/server.module';
import { Events, wa } from '@api/types/wa.types';
import { Auth, Chatwoot, ConfigService, HttpServer, Proxy } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { NotFoundException } from '@exceptions';
import { Contact, Message, Prisma } from '@prisma/client';
import { createJid } from '@utils/createJid';
import { WASocket } from 'baileys';
import { isArray } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';

import { CacheService } from './cache.service';

export class ChannelStartupService {
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly chatwootCache: CacheService,
  ) {
    // Service initialization must happen inside the constructor body (not as
    // class field initializers) because tsup/esbuild compiles field initializers
    // to run BEFORE constructor parameter properties are assigned.  That caused
    // `this.configService` to be `undefined` at the time ChatwootService /
    // OpenaiService / etc. were instantiated.
    this.chatwootService = new ChatwootService(waMonitor, this.configService, this.prismaRepository, this.chatwootCache);
    this.openaiService = new OpenaiService(waMonitor, this.prismaRepository, this.configService);
    this.typebotService = new TypebotService(waMonitor, this.configService, this.prismaRepository, this.openaiService);
    this.difyService = new DifyService(waMonitor, this.prismaRepository, this.configService, this.openaiService);
  }

  public readonly logger = new Logger('ChannelStartupService');

  public client: WASocket;
  public readonly instance: wa.Instance = {};
  public readonly localChatwoot: wa.LocalChatwoot = {};
  public readonly localProxy: wa.LocalProxy = {};
  public readonly localSettings: wa.LocalSettings = {};
  public readonly localWebhook: wa.LocalWebHook = {};

  public chatwootService: ChatwootService;

  public openaiService: OpenaiService;

  public typebotService: TypebotService;

  public difyService: DifyService;

  public setInstance(instance: InstanceDto) {
    this.logger.setInstance(instance.instanceName);

    this.instance.name = instance.instanceName;
    this.instance.id = instance.instanceId;
    this.instance.integration = instance.integration;
    this.instance.number = instance.number;
    this.instance.token = instance.token;
    this.instance.businessId = instance.businessId;
    this.instance.ownerJid = instance.ownerJid;

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      this.chatwootService.eventWhatsapp(
        Events.STATUS_INSTANCE,
        { instanceName: this.instance.name },
        {
          instance: this.instance.name,
          status: 'created',
        },
      );
    }
  }

  public set instanceName(name: string) {
    this.logger.setInstance(name);

    if (!name) {
      this.instance.name = v4();
      return;
    }
    this.instance.name = name;
  }

  public get instanceName() {
    return this.instance.name;
  }

  public set instanceId(id: string) {
    if (!id) {
      this.instance.id = v4();
      return;
    }
    this.instance.id = id;
  }

  public get instanceId() {
    return this.instance.id;
  }

  public set integration(integration: string) {
    this.instance.integration = integration;
  }

  public get integration() {
    return this.instance.integration;
  }

  public set number(number: string) {
    this.instance.number = number;
  }

  public get number() {
    return this.instance.number;
  }

  public set token(token: string) {
    this.instance.token = token;
  }

  public get token() {
    return this.instance.token;
  }

  public get wuid() {
    return this.instance.wuid;
  }

  public async loadWebhook() {
    const data = await this.prismaRepository.webhook.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    this.localWebhook.enabled = data?.enabled;
    this.localWebhook.webhookBase64 = data?.webhookBase64;
  }

  public async loadSettings() {
    const data = await this.prismaRepository.setting.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    this.localSettings.rejectCall = data?.rejectCall;
    this.localSettings.msgCall = data?.msgCall;
    this.localSettings.groupsIgnore = data?.groupsIgnore;
    this.localSettings.alwaysOnline = data?.alwaysOnline;
    this.localSettings.readMessages = data?.readMessages;
    this.localSettings.readStatus = data?.readStatus;
    this.localSettings.syncFullHistory = data?.syncFullHistory;
    this.localSettings.wavoipToken = data?.wavoipToken;
  }

  public async setSettings(data: SettingsDto) {
    await this.prismaRepository.setting.upsert({
      where: {
        instanceId: this.instanceId,
      },
      update: {
        rejectCall: data.rejectCall,
        msgCall: data.msgCall,
        groupsIgnore: data.groupsIgnore,
        alwaysOnline: data.alwaysOnline,
        readMessages: data.readMessages,
        readStatus: data.readStatus,
        syncFullHistory: data.syncFullHistory,
        wavoipToken: data.wavoipToken,
      },
      create: {
        rejectCall: data.rejectCall,
        msgCall: data.msgCall,
        groupsIgnore: data.groupsIgnore,
        alwaysOnline: data.alwaysOnline,
        readMessages: data.readMessages,
        readStatus: data.readStatus,
        syncFullHistory: data.syncFullHistory,
        wavoipToken: data.wavoipToken,
        instanceId: this.instanceId,
      },
    });

    this.localSettings.rejectCall = data?.rejectCall;
    this.localSettings.msgCall = data?.msgCall;
    this.localSettings.groupsIgnore = data?.groupsIgnore;
    this.localSettings.alwaysOnline = data?.alwaysOnline;
    this.localSettings.readMessages = data?.readMessages;
    this.localSettings.readStatus = data?.readStatus;
    this.localSettings.syncFullHistory = data?.syncFullHistory;
    this.localSettings.wavoipToken = data?.wavoipToken;

    if (this.localSettings.wavoipToken && this.localSettings.wavoipToken.length > 0) {
      this.client.ws.close();
      this.client.ws.connect();
    }
  }

  public async findSettings() {
    const data = await this.prismaRepository.setting.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    if (!data) {
      return null;
    }

    return {
      rejectCall: data.rejectCall,
      msgCall: data.msgCall,
      groupsIgnore: data.groupsIgnore,
      alwaysOnline: data.alwaysOnline,
      readMessages: data.readMessages,
      readStatus: data.readStatus,
      syncFullHistory: data.syncFullHistory,
      wavoipToken: data.wavoipToken,
    };
  }

  public async loadChatwoot() {
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
      return;
    }

    const data = await this.prismaRepository.chatwoot.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    this.localChatwoot.enabled = data?.enabled;
    this.localChatwoot.accountId = data?.accountId;
    this.localChatwoot.token = data?.token;
    this.localChatwoot.url = data?.url;
    this.localChatwoot.nameInbox = data?.nameInbox;
    this.localChatwoot.signMsg = data?.signMsg;
    this.localChatwoot.signDelimiter = data?.signDelimiter;
    this.localChatwoot.number = data?.number;
    this.localChatwoot.reopenConversation = data?.reopenConversation;
    this.localChatwoot.conversationPending = data?.conversationPending;
    this.localChatwoot.mergeBrazilContacts = data?.mergeBrazilContacts;
    this.localChatwoot.importContacts = data?.importContacts;
    this.localChatwoot.importMessages = data?.importMessages;
    this.localChatwoot.daysLimitImportMessages = data?.daysLimitImportMessages;
  }

  public async setChatwoot(data: ChatwootDto) {
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
      return;
    }

    const chatwoot = await this.prismaRepository.chatwoot.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    if (chatwoot) {
      await this.prismaRepository.chatwoot.update({
        where: {
          instanceId: this.instanceId,
        },
        data: {
          enabled: data?.enabled,
          accountId: data.accountId,
          token: data.token,
          url: data.url,
          nameInbox: data.nameInbox,
          signMsg: data.signMsg,
          signDelimiter: data.signMsg ? data.signDelimiter : null,
          number: data.number,
          reopenConversation: data.reopenConversation,
          conversationPending: data.conversationPending,
          mergeBrazilContacts: data.mergeBrazilContacts,
          importContacts: data.importContacts,
          importMessages: data.importMessages,
          daysLimitImportMessages: data.daysLimitImportMessages,
          organization: data.organization,
          logo: data.logo,
          ignoreJids: data.ignoreJids,
        },
      });

      Object.assign(this.localChatwoot, { ...data, signDelimiter: data.signMsg ? data.signDelimiter : null });

      this.clearCacheChatwoot();
      return;
    }

    await this.prismaRepository.chatwoot.create({
      data: {
        enabled: data?.enabled,
        accountId: data.accountId,
        token: data.token,
        url: data.url,
        nameInbox: data.nameInbox,
        signMsg: data.signMsg,
        number: data.number,
        reopenConversation: data.reopenConversation,
        conversationPending: data.conversationPending,
        mergeBrazilContacts: data.mergeBrazilContacts,
        importContacts: data.importContacts,
        importMessages: data.importMessages,
        daysLimitImportMessages: data.daysLimitImportMessages,
        organization: data.organization,
        logo: data.logo,
        ignoreJids: data.ignoreJids,
        instanceId: this.instanceId,
      },
    });

    Object.assign(this.localChatwoot, { ...data, signDelimiter: data.signMsg ? data.signDelimiter : null });

    this.clearCacheChatwoot();
  }

  public async findChatwoot(): Promise<ChatwootDto | null> {
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
      return null;
    }

    const data = await this.prismaRepository.chatwoot.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    if (!data) {
      return null;
    }

    const ignoreJidsArray = Array.isArray(data.ignoreJids) ? data.ignoreJids.map((event) => String(event)) : [];

    return {
      enabled: data?.enabled,
      accountId: data.accountId,
      token: data.token,
      url: data.url,
      nameInbox: data.nameInbox,
      signMsg: data.signMsg,
      signDelimiter: data.signDelimiter || null,
      reopenConversation: data.reopenConversation,
      conversationPending: data.conversationPending,
      mergeBrazilContacts: data.mergeBrazilContacts,
      importContacts: data.importContacts,
      importMessages: data.importMessages,
      daysLimitImportMessages: data.daysLimitImportMessages,
      organization: data.organization,
      logo: data.logo,
      ignoreJids: ignoreJidsArray,
    };
  }

  public clearCacheChatwoot() {
    if (this.localChatwoot?.enabled) {
      this.chatwootService.getCache()?.deleteAll(this.instanceName);
    }
  }

  public async loadProxy() {
    this.localProxy.enabled = false;

    const proxyConfig = this.configService.get<Proxy>('PROXY');
    if (proxyConfig.HOST) {
      this.localProxy.enabled = true;
      this.localProxy.host = proxyConfig.HOST;
      this.localProxy.port = proxyConfig.PORT || '80';
      this.localProxy.protocol = proxyConfig.PROTOCOL || 'http';
      this.localProxy.username = proxyConfig.USERNAME;
      this.localProxy.password = proxyConfig.PASSWORD;
    }

    const data = await this.prismaRepository.proxy.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    if (data?.enabled) {
      this.localProxy.enabled = true;
      this.localProxy.host = data?.host;
      this.localProxy.port = data?.port;
      this.localProxy.protocol = data?.protocol;
      this.localProxy.username = data?.username;
      this.localProxy.password = data?.password;
    }
  }

  public async setProxy(data: ProxyDto) {
    await this.prismaRepository.proxy.upsert({
      where: {
        instanceId: this.instanceId,
      },
      update: {
        enabled: data?.enabled,
        host: data.host,
        port: data.port,
        protocol: data.protocol,
        username: data.username,
        password: data.password,
      },
      create: {
        enabled: data?.enabled,
        host: data.host,
        port: data.port,
        protocol: data.protocol,
        username: data.username,
        password: data.password,
        instanceId: this.instanceId,
      },
    });

    Object.assign(this.localProxy, data);
  }

  public async findProxy() {
    const data = await this.prismaRepository.proxy.findUnique({
      where: {
        instanceId: this.instanceId,
      },
    });

    if (!data) {
      throw new NotFoundException('Proxy not found');
    }

    return data;
  }

  public async sendDataWebhook<T extends object = any>(
    event: Events,
    data: T,
    local = true,
    integration?: string[],
    extra?: Record<string, any>,
  ) {
    const serverUrl = this.configService.get<HttpServer>('SERVER').URL;
    const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
    const localISOTime = new Date(Date.now() - tzoffset).toISOString();
    const now = localISOTime;

    const expose = this.configService.get<Auth>('AUTHENTICATION').EXPOSE_IN_FETCH_INSTANCES;

    const instanceApikey = this.token || 'Apikey not found';

    await eventManager.emit({
      instanceName: this.instance.name,
      origin: ChannelStartupService.name,
      event,
      data,
      serverUrl,
      dateTime: now,
      sender: this.wuid,
      apiKey: expose && instanceApikey ? instanceApikey : null,
      local,
      integration,
      extra,
    });
  }

  // Check if the number is MX or AR
  public formatMXOrARNumber(jid: string): string {
    const countryCode = jid.substring(0, 2);

    if (Number(countryCode) === 52 || Number(countryCode) === 54) {
      if (jid.length === 13) {
        const number = countryCode + jid.substring(3);
        return number;
      }

      return jid;
    }
    return jid;
  }

  // Check if the number is br
  public formatBRNumber(jid: string) {
    const regexp = new RegExp(/^(\d{2})(\d{2})\d{1}(\d{8})$/);
    if (regexp.test(jid)) {
      const match = regexp.exec(jid);
      if (match && match[1] === '55') {
        const joker = Number.parseInt(match[3][0]);
        const ddd = Number.parseInt(match[2]);
        if (joker < 7 || ddd < 31) {
          return match[0];
        }
        return match[1] + match[2] + match[3];
      }
      return jid;
    } else {
      return jid;
    }
  }

  public async fetchContacts(query: Query<Contact>) {
    const where: any = {
      instanceId: this.instanceId,
    };

    if (query?.where?.remoteJid) {
      const remoteJid = query.where.remoteJid.includes('@') ? query.where.remoteJid : createJid(query.where.remoteJid);
      where['remoteJid'] = remoteJid;
    }

    if (query?.where?.id) {
      where['id'] = query.where.id;
    }

    if (query?.where?.pushName) {
      where['pushName'] = query.where.pushName;
    }

    const contactFindManyArgs: Prisma.ContactFindManyArgs = {
      where,
    };

    if (query.offset) contactFindManyArgs.take = query.offset;
    if (query.page) {
      const validPage = Math.max(query.page as number, 1);
      contactFindManyArgs.skip = query.offset * (validPage - 1);
    }

    const contacts = await this.prismaRepository.contact.findMany(contactFindManyArgs);

    return contacts.map((contact) => {
      const remoteJid = contact.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const isSaved = !!contact.pushName || !!contact.profilePicUrl;
      const type = isGroup ? 'group' : isSaved ? 'contact' : 'group_member';
      return {
        ...contact,
        isGroup,
        isSaved,
        type,
      };
    });
  }

  public cleanMessageData(message: any) {
    if (!message) return message;
    const cleanedMessage = { ...message };

    if (cleanedMessage.message) {
      const { mediaUrl } = cleanedMessage.message;
      delete cleanedMessage.message.base64;

      // Limpa imageMessage
      if (cleanedMessage.message.imageMessage) {
        cleanedMessage.message.imageMessage = {
          caption: cleanedMessage.message.imageMessage.caption,
        };
      }

      // Limpa videoMessage
      if (cleanedMessage.message.videoMessage) {
        cleanedMessage.message.videoMessage = {
          caption: cleanedMessage.message.videoMessage.caption,
        };
      }

      // Limpa audioMessage
      if (cleanedMessage.message.audioMessage) {
        cleanedMessage.message.audioMessage = {
          seconds: cleanedMessage.message.audioMessage.seconds,
        };
      }

      // Limpa stickerMessage
      if (cleanedMessage.message.stickerMessage) {
        cleanedMessage.message.stickerMessage = {};
      }

      // Limpa documentMessage
      if (cleanedMessage.message.documentMessage) {
        cleanedMessage.message.documentMessage = {
          caption: cleanedMessage.message.documentMessage.caption,
          name: cleanedMessage.message.documentMessage.name,
        };
      }

      // Limpa documentWithCaptionMessage
      if (cleanedMessage.message.documentWithCaptionMessage) {
        cleanedMessage.message.documentWithCaptionMessage = {
          caption: cleanedMessage.message.documentWithCaptionMessage.caption,
          name: cleanedMessage.message.documentWithCaptionMessage.name,
        };
      }

      if (mediaUrl) cleanedMessage.message.mediaUrl = mediaUrl;
    }

    return cleanedMessage;
  }

  /**
   * Build the remoteJid filter for message queries.
   *
   * When the caller passes a @s.whatsapp.net JID we also need to find messages
   * stored under the corresponding @lid (Linked ID) JID that WhatsApp Multi-Device
   * may have used.  Messages saved with @lid carry their phone-based JID in
   * key.remoteJidAlt, so we use an OR condition:
   *
   *   key.remoteJid = requestedJid              (normal match)
   *   OR key.remoteJidAlt = requestedJid         (@lid messages whose alt matches)
   *
   * This transparently returns all messages for a phone number regardless of
   * whether they were stored with @s.whatsapp.net or @lid as remoteJid.
   */
  private buildRemoteJidFilter(remoteJid: string): object {
    return {
      OR: [
        { key: { path: ['remoteJid'], equals: remoteJid } },
        { key: { path: ['remoteJidAlt'], equals: remoteJid } },
      ],
    };
  }

  public async fetchMessages(query: Query<Message>) {
    const keyFilters = query?.where?.key as {
      id?: string;
      fromMe?: boolean;
      remoteJid?: string;
      participants?: string;
    };

    const timestampFilter = {};
    if (query?.where?.messageTimestamp) {
      if (query.where.messageTimestamp['gte'] && query.where.messageTimestamp['lte']) {
        timestampFilter['messageTimestamp'] = {
          gte: Math.floor(new Date(query.where.messageTimestamp['gte']).getTime() / 1000),
          lte: Math.floor(new Date(query.where.messageTimestamp['lte']).getTime() / 1000),
        };
      }
    }

    const count = await this.prismaRepository.message.count({
      where: {
        instanceId: this.instanceId,
        id: query?.where?.id,
        source: query?.where?.source,
        messageType: query?.where?.messageType,
        ...timestampFilter,
        AND: [
          keyFilters?.id ? { key: { path: ['id'], equals: keyFilters?.id } } : {},
          keyFilters?.fromMe ? { key: { path: ['fromMe'], equals: keyFilters?.fromMe } } : {},
          keyFilters?.remoteJid ? this.buildRemoteJidFilter(keyFilters.remoteJid) : {},
          keyFilters?.participants ? { key: { path: ['participants'], equals: keyFilters?.participants } } : {},
        ],
      },
    });

    if (!query?.offset) {
      query.offset = 50;
    }

    if (!query?.page) {
      query.page = 1;
    }

    const messages = await this.prismaRepository.message.findMany({
      where: {
        instanceId: this.instanceId,
        id: query?.where?.id,
        source: query?.where?.source,
        messageType: query?.where?.messageType,
        ...timestampFilter,
        AND: [
          keyFilters?.id ? { key: { path: ['id'], equals: keyFilters?.id } } : {},
          keyFilters?.fromMe ? { key: { path: ['fromMe'], equals: keyFilters?.fromMe } } : {},
          keyFilters?.remoteJid ? this.buildRemoteJidFilter(keyFilters.remoteJid) : {},
          keyFilters?.participants ? { key: { path: ['participants'], equals: keyFilters?.participants } } : {},
        ],
      },
      orderBy: {
        messageTimestamp: 'desc',
      },
      skip: query.offset * (query?.page === 1 ? 0 : (query?.page as number) - 1),
      take: query.offset,
      select: {
        id: true,
        key: true,
        pushName: true,
        messageType: true,
        message: true,
        messageTimestamp: true,
        instanceId: true,
        source: true,
        contextInfo: true,
        MessageUpdate: {
          select: {
            status: true,
          },
        },
      },
    });

    return {
      messages: {
        total: count,
        pages: Math.ceil(count / query.offset),
        currentPage: query.page,
        records: messages,
      },
    };
  }

  public async fetchStatusMessage(query: any) {
    if (!query?.offset) {
      query.offset = 50;
    }

    if (!query?.page) {
      query.page = 1;
    }

    return await this.prismaRepository.messageUpdate.findMany({
      where: {
        instanceId: this.instanceId,
        remoteJid: query.where?.remoteJid,
        keyId: query.where?.id,
      },
      skip: query.offset * (query?.page === 1 ? 0 : (query?.page as number) - 1),
      take: query.offset,
    });
  }

  public async findChatByRemoteJid(remoteJid: string) {
    if (!remoteJid) return null;
    return await this.prismaRepository.chat.findFirst({
      where: {
        instanceId: this.instanceId,
        remoteJid: remoteJid,
      },
    });
  }

  public async fetchChats(query: any) {
    const remoteJid = query?.where?.remoteJid
      ? query?.where?.remoteJid.includes('@')
        ? query.where?.remoteJid
        : createJid(query.where?.remoteJid)
      : null;

    const timestampFilter =
      query?.where?.messageTimestamp?.gte && query?.where?.messageTimestamp?.lte
        ? Prisma.sql`
        AND "Message"."messageTimestamp" >= ${Math.floor(new Date(query.where.messageTimestamp.gte).getTime() / 1000)}
        AND "Message"."messageTimestamp" <= ${Math.floor(new Date(query.where.messageTimestamp.lte).getTime() / 1000)}`
        : Prisma.sql``;

    const limit = query?.take ? Prisma.sql`LIMIT ${query.take}` : Prisma.sql``;
    const offset = query?.skip ? Prisma.sql`OFFSET ${query.skip}` : Prisma.sql``;

    // resolvedJid: for @lid messages that carry remoteJidAlt, use it to group
    // the chat under the phone-based JID instead of creating a duplicate entry.
    // LidContact: fallback join for contacts saved with @lid before the fix.
    const results = await this.prismaRepository.$queryRaw`
      WITH rankedMessages AS (
        SELECT DISTINCT ON (COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid'))
          COALESCE("Contact"."id", "LidContact"."id") as "contactId",
          COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid') as "remoteJid",
          CASE 
            WHEN COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid') LIKE '%@g.us'
              THEN COALESCE("Chat"."name", "LidChat"."name", "Contact"."pushName", "LidContact"."pushName")
            ELSE COALESCE("Contact"."pushName", "LidContact"."pushName", "Message"."pushName")
          END as "pushName",
          COALESCE("Contact"."profilePicUrl", "LidContact"."profilePicUrl") as "profilePicUrl",
          COALESCE(
            to_timestamp("Message"."messageTimestamp"::double precision), 
            "Contact"."updatedAt",
            "LidContact"."updatedAt"
          ) as "updatedAt",
          COALESCE("Chat"."name", "LidChat"."name") as "chatName",
          COALESCE("Chat"."createdAt", "LidChat"."createdAt") as "windowStart",
          COALESCE("Chat"."createdAt", "LidChat"."createdAt") + INTERVAL '24 hours' as "windowExpires",
          COALESCE("Chat"."unreadMessages", "LidChat"."unreadMessages") as "unreadMessages",
          CASE WHEN COALESCE("Chat"."createdAt", "LidChat"."createdAt") + INTERVAL '24 hours' > NOW() THEN true ELSE false END as "windowActive",
          "Message"."id" AS "lastMessageId",
          "Message"."key" AS "lastMessage_key",
          CASE
            WHEN "Message"."key"->>'fromMe' = 'true' THEN 'Você'
            ELSE "Message"."pushName"
          END AS "lastMessagePushName",
          "Message"."participant" AS "lastMessageParticipant",
          "Message"."messageType" AS "lastMessageMessageType",
          "Message"."message" AS "lastMessageMessage",
          "Message"."contextInfo" AS "lastMessageContextInfo",
          "Message"."source" AS "lastMessageSource",
          "Message"."messageTimestamp" AS "lastMessageMessageTimestamp",
          "Message"."instanceId" AS "lastMessageInstanceId",
          "Message"."sessionId" AS "lastMessageSessionId",
          "Message"."status" AS "lastMessageStatus"
        FROM "Message"
        LEFT JOIN "Contact"
          ON "Contact"."remoteJid" = COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid')
          AND "Contact"."instanceId" = "Message"."instanceId"
        LEFT JOIN "Contact" AS "LidContact"
          ON "LidContact"."remoteJid" = "Message"."key"->>'remoteJid'
          AND "LidContact"."instanceId" = "Message"."instanceId"
          AND "Contact"."id" IS NULL
        LEFT JOIN "Chat"
          ON "Chat"."remoteJid" = COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid')
          AND "Chat"."instanceId" = "Message"."instanceId"
        LEFT JOIN "Chat" AS "LidChat"
          ON "LidChat"."remoteJid" = "Message"."key"->>'remoteJid'
          AND "LidChat"."instanceId" = "Message"."instanceId"
          AND "Chat"."id" IS NULL
        WHERE "Message"."instanceId" = ${this.instanceId}
        ${remoteJid ? Prisma.sql`AND COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid') = ${remoteJid}` : Prisma.sql``}
        ${timestampFilter}
        ORDER BY COALESCE("Message"."key"->>'remoteJidAlt', "Message"."key"->>'remoteJid'), "Message"."messageTimestamp" DESC
      )
      SELECT * FROM rankedMessages 
      ORDER BY "updatedAt" DESC NULLS LAST
      ${limit}
      ${offset};
    `;

    if (results && isArray(results) && results.length > 0) {
      // Resolve @lid JIDs to phone numbers using Baileys LID mapping.
      // When WhatsApp Multi-Device sends messages with @lid identifiers and
      // no remoteJidAlt, the COALESCE in SQL falls back to the @lid value.
      // We use the Baileys signal repository to convert these to real numbers.
      const lidMapping = this.client?.signalRepository?.lidMapping;
      const lidContacts = results.filter((c) => String(c.remoteJid).includes('@lid'));

      if (lidContacts.length > 0 && lidMapping?.getPNForLID) {
        const resolvePromises = lidContacts.map(async (contact) => {
          try {
            const resolved = await lidMapping.getPNForLID(contact.remoteJid as string);
            if (resolved && !resolved.includes('@lid')) {
              contact.remoteJid = resolved;
            }
          } catch (err) {
            this.logger.warn(`fetchChats: failed to resolve LID ${contact.remoteJid}: ${err?.message}`);
          }
        });
        await Promise.allSettled(resolvePromises);
      }

      // Deduplicate: after LID resolution, multiple entries may map to the same
      // phone JID. Keep only the one with the most recent updatedAt.
      const deduped = new Map<string, (typeof results)[number]>();
      for (const contact of results) {
        const jid = String(contact.remoteJid);
        const existing = deduped.get(jid);
        if (!existing || (contact.updatedAt && (!existing.updatedAt || contact.updatedAt > existing.updatedAt))) {
          deduped.set(jid, contact);
        }
      }
      const uniqueResults = [...deduped.values()];

      const mappedResults = uniqueResults.map((contact) => {
        const lastMessage = contact.lastMessageId
          ? {
              id: contact.lastMessageId,
              key: contact.lastMessage_key,
              pushName: contact.lastMessagePushName,
              participant: contact.lastMessageParticipant,
              messageType: contact.lastMessageMessageType,
              message: contact.lastMessageMessage,
              contextInfo: contact.lastMessageContextInfo,
              source: contact.lastMessageSource,
              messageTimestamp: contact.lastMessageMessageTimestamp,
              instanceId: contact.lastMessageInstanceId,
              sessionId: contact.lastMessageSessionId,
              status: contact.lastMessageStatus,
            }
          : undefined;

        return {
          id: contact.contactId || null,
          remoteJid: contact.remoteJid,
          pushName: contact.pushName,
          profilePicUrl: contact.profilePicUrl,
          updatedAt: contact.updatedAt,
          windowStart: contact.windowStart,
          windowExpires: contact.windowExpires,
          windowActive: contact.windowActive,
          lastMessage: lastMessage ? this.cleanMessageData(lastMessage) : undefined,
          unreadCount: contact.unreadMessages,
          isSaved: !!contact.contactId,
        };
      });

      return mappedResults;
    }

    return [];
  }

  public hasValidMediaContent(message: any): boolean {
    if (!message?.message) return false;

    const msg = message.message;

    // Se só tem messageContextInfo, não é mídia válida
    if (Object.keys(msg).length === 1 && Object.prototype.hasOwnProperty.call(msg, 'messageContextInfo')) {
      return false;
    }

    // Verifica se tem pelo menos um tipo de mídia válido
    const mediaTypes = [
      'imageMessage',
      'videoMessage',
      'stickerMessage',
      'documentMessage',
      'documentWithCaptionMessage',
      'ptvMessage',
      'audioMessage',
    ];

    return mediaTypes.some((type) => msg[type] && Object.keys(msg[type]).length > 0);
  }
}
