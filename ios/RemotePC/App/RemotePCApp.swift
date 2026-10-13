import SwiftUI
import UIKit
import UserNotifications

@main
struct RemotePCApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onOpenURL { url in model.handleOpenURL(url) }
                .onReceive(NotificationCenter.default.publisher(for: .openSessionFromNotification)) { note in
                    if let key = note.object as? String { model.open(sessionKey: key) }
                }
        }
    }
}

extension Notification.Name {
    static let openSessionFromNotification = Notification.Name("openSessionFromNotification")
}

/// Shows local notifications while the app is open and routes taps to the right session.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let key = response.notification.request.content.userInfo["sessionKey"] as? String {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .openSessionFromNotification, object: key)
            }
        }
        completionHandler()
    }
}
