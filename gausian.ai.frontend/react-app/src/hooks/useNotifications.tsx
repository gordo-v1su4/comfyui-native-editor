import React, { useState, useCallback, useEffect } from 'react';

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  timestamp: Date;
}

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((
    message: string,
    type: Notification['type'] = 'info',
    duration: number = 5000
  ) => {
    const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const notification: Notification = {
      id,
      message,
      type,
      duration,
      timestamp: new Date(),
    };

    setNotifications(prev => [...prev, notification]);

    // Auto-remove notification after duration
    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    }

    return id;
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Clean up old notifications (older than 1 hour)
  useEffect(() => {
    const cleanup = () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      setNotifications(prev => 
        prev.filter(n => n.timestamp > oneHourAgo)
      );
    };

    const interval = setInterval(cleanup, 5 * 60 * 1000); // Clean every 5 minutes
    return () => clearInterval(interval);
  }, []);

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAllNotifications,
  };
};

// Notification component
export const NotificationToast: React.FC<{
  notification: Notification;
  onRemove: (id: string) => void;
}> = ({ notification, onRemove }) => {
  const getStyle = () => {
    const baseStyle = {
      padding: '12px 16px',
      borderRadius: '4px',
      marginBottom: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '14px',
      fontWeight: '500',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      border: '1px solid',
      maxWidth: '400px',
      wordBreak: 'break-word' as const,
    };

    switch (notification.type) {
      case 'success':
        return {
          ...baseStyle,
          backgroundColor: '#d4edda',
          color: '#155724',
          borderColor: '#c3e6cb',
        };
      case 'error':
        return {
          ...baseStyle,
          backgroundColor: '#f8d7da',
          color: '#721c24',
          borderColor: '#f5c6cb',
        };
      case 'warning':
        return {
          ...baseStyle,
          backgroundColor: '#fff3cd',
          color: '#856404',
          borderColor: '#ffeaa7',
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: '#d1ecf1',
          color: '#0c5460',
          borderColor: '#bee5eb',
        };
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div style={getStyle()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{getIcon()}</span>
        <span>{notification.message}</span>
      </div>
      <button
        onClick={() => onRemove(notification.id)}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '16px',
          cursor: 'pointer',
          padding: '0',
          marginLeft: '8px',
          opacity: 0.7,
        }}
      >
        ×
      </button>
    </div>
  );
};

export const NotificationContainer: React.FC<{
  notifications: Notification[];
  onRemove: (id: string) => void;
}> = ({ notifications, onRemove }) => {
  if (notifications.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 10000,
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      {notifications.map(notification => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
};

