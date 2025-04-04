import { HttpService } from '@nestjs/axios';
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as puppeteer from 'puppeteer';
import { firstValueFrom } from 'rxjs';
import { sendMessageQueryParams } from 'src/api/dto/get-send';
import { EvalueChatService } from 'src/services/evalue-chat/evalue-chat.service';

@Processor('send-message-trigger')
export class sendMessageTriggerConsumer {
  private readonly logger = new Logger(sendMessageTriggerConsumer.name);
  
  constructor(
    private readonly httpService: HttpService,
    private readonly evalueChatService: EvalueChatService,
  ) {}

  @Process('send-message-trigger-job')
  async sendMessager(job: Job<any>) {
    const data = job.data as sendMessageQueryParams;
    return this.sendManual(data);
  }

  async sendManual(data: sendMessageQueryParams) {
    const { gerar_pdf, mensagem, numero, token, key } = data;
    const urls = this.extractUrlsFromMessage(mensagem);
    const base64Urls = [];

    console.log('Enviando mensagem:', mensagem);
    
    

    if (gerar_pdf === 'sim') {
      if (urls.length > 0) {
        for (const url of urls) {
          try {
            const base64Data = await this.downloadAndConvertToBase64(url, true);
            base64Urls.push({
              originalUrl: url,
              base64Data: base64Data,
            });
          } catch (error) {
            console.error(`Erro ao baixar a URL ${url}:`, error.message);
          }
        }
      }
    } else {
      if (urls.length > 0) {
        for (const url of urls) {
          try {
            const base64Data = await this.downloadAndConvertToBase64(url, false);
            base64Urls.push({
              originalUrl: url,
              base64Data: base64Data,
            });
          } catch (error) {
            console.error(`Erro ao baixar a URL ${url}:`, error.message);
          }
        }
      }
    }

    console.log(base64Urls.length, gerar_pdf);
    
    
    if (base64Urls.length > 0 && gerar_pdf === 'sim') {
      console.log('Enviando mensagem com media');
      await this.evalueChatService.sendMessageMedia({
        instancia: data.key,
        mensagem: mensagem,
        numero: numero,
        token: token,
        media: base64Urls.map((url) => url.base64Data),
      });
    } else {
      await this.evalueChatService.sendMessage({
        instancia: data.key,
        mensagem: mensagem,
        numero: numero,
        token: token,
      });
    }

    return {
      numero,
      urls,
      base64Urls,
    };
  }

  /**
   * Extrai todas as URLs de uma string
   * @param message - A mensagem de texto para extrair URLs
   * @returns Um array contendo todas as URLs encontradas na mensagem
   */
  private extractUrlsFromMessage(message: string): string[] {
    if (!message) return [];
    // Regex para encontrar URLs (suporta HTTP, HTTPS, FTP e URLs sem protocolo)
    const urlRegex =
      /(https?:\/\/|www\.)[^\s,()<>]+(?:\([\w\d]+\)|([^,()<>!\s]|\([^,()<>!\s]*\)))/gi;
    // Encontrar todas as ocorrências da regex na mensagem
    const matches = message.match(urlRegex);
    // Retornar array vazio se não encontrar URLs
    return matches || [];
  }

  /**
   * Baixa uma URL e converte o conteúdo para base64
   * @param url - A URL para ser baixada
   * @param convertToPdf - Indica se deve converter o conteúdo HTML para PDF
   * @returns Uma Promise com a string em formato base64
   */
  private async downloadAndConvertToBase64(url: string, convertToPdf: boolean = false): Promise<string> {
    // Garantir que a URL tenha o protocolo
    const validUrl = url.startsWith('http') ? url : `https://${url}`;
    
    this.logger.log(`Starting to process URL: ${validUrl}`);
    this.logger.log(`Convert to PDF: ${convertToPdf}`);

    try {
      if (convertToPdf) {
        this.logger.log('Launching Puppeteer browser...');
        const browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        
        const page = await browser.newPage();
        this.logger.log('Navigating to page...');
        
        await page.goto(validUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        
        this.logger.log('Generating PDF...');
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20px',
            right: '20px',
            bottom: '20px',
            left: '20px',
          },
        });
        
        await browser.close();
        this.logger.log('PDF generated successfully');
        
        return Buffer.from(pdfBuffer).toString('base64');
      } else {
        this.logger.log('Making HTTP request...');
        const response = await firstValueFrom(
          this.httpService.get(validUrl, {
            responseType: 'arraybuffer',
          }),
        );
        
        this.logger.log('Content downloaded successfully');
        return Buffer.from(response.data).toString('base64');
      }
    } catch (error) {
      this.logger.error(`Error processing URL ${validUrl}: ${error.message}`);
      throw error;
    }
  }
}