import Foundation
import Security

/// Stores pairing tokens in the Keychain. Some sideloading setups strip the keychain
/// entitlement, so fall back to UserDefaults rather than leaving the app unusable.
enum Keychain {
    private static let service = "RemotePC"

    private static func base(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func set(_ value: String, for account: String) {
        SecItemDelete(base(account) as CFDictionary)
        var add = base(account)
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess {
            UserDefaults.standard.removeObject(forKey: "token.\(account)")
        } else {
            UserDefaults.standard.set(value, forKey: "token.\(account)")
        }
    }

    static func get(_ account: String) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        if SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data {
            return String(data: data, encoding: .utf8)
        }
        return UserDefaults.standard.string(forKey: "token.\(account)")
    }

    static func delete(_ account: String) {
        SecItemDelete(base(account) as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "token.\(account)")
    }
}
