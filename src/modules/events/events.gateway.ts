import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * WebSocket gateway for real-time event updates.
 * Clients join rooms per event to receive live probability updates
 * when lineups are confirmed or data is refreshed.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Client subscribes to updates for a specific event.
   */
  @SubscribeMessage('join_event')
  handleJoinEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventId: string,
  ) {
    client.join(`event:${eventId}`);
    this.logger.debug(`Client ${client.id} joined event:${eventId}`);
    return { subscribed: eventId };
  }

  /**
   * Client unsubscribes from event updates.
   */
  @SubscribeMessage('leave_event')
  handleLeaveEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventId: string,
  ) {
    client.leave(`event:${eventId}`);
    return { unsubscribed: eventId };
  }

  /**
   * Push updated probabilities to all clients watching an event.
   * Called internally by the ProbabilityEngine after recomputation.
   */
  broadcastPicksUpdate(eventId: string, picks: unknown) {
    this.server.to(`event:${eventId}`).emit('picks_updated', {
      eventId,
      picks,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Push event status change (e.g., LIVE, LINEUP_CONFIRMED).
   */
  broadcastEventStatus(eventId: string, status: string, scores?: unknown) {
    this.server.to(`event:${eventId}`).emit('event_status', {
      eventId,
      status,
      scores,
      updatedAt: new Date().toISOString(),
    });
  }
}
