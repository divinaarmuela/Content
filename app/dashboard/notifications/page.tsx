export default function NotificationsPage() {
  return (
    <div className="db-page">
      <div className="db-page-header">
        <div>
          <h1 className="db-page-title">Notifications</h1>
          <p className="db-page-sub">7 unread</p>
        </div>
      </div>
      <div className="db-card">
        <div className="db-card-body" style={{ padding: 40, textAlign: 'center', color: '#a8a5bb', fontSize: 13 }}>
          No notifications yet.
        </div>
      </div>
    </div>
  )
}
