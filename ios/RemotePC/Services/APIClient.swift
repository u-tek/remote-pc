import Foundation

struct APIError: LocalizedError {
    var status: Int
    var message: String

    var errorDescription: String? { message }
}

/// HTTP client for one paired PC. Every request carries the pairing token.
final class APIClient {
    let host: String
    let port: Int
    let token: String
    let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(host: String, port: Int, token: String) {
        self.host = host
        self.port = port
        self.token = token
        var comps = URLComponents()
        comps.scheme = "http"
        comps.host = host.contains(":") ? "[\(host)]" : host
        comps.port = port
        baseURL = comps.url ?? URL(string: "http://127.0.0.1:8787")!
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60 * 60
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    func url(_ path: String, query: [String: String] = [:]) -> URL {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.percentEncodedPath = path.split(separator: "/", omittingEmptySubsequences: false)
            .map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? String($0) }
            .joined(separator: "/")
        if !query.isEmpty {
            comps.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return comps.url!
    }

    /// URL that carries the token itself, for players and web views that cannot set headers.
    func tokenURL(_ path: String, query: [String: String] = [:]) -> URL {
        var q = query
        q["token"] = token
        return url(path, query: q)
    }

    func request(_ method: String, _ path: String, query: [String: String] = [:]) -> URLRequest {
        var req = URLRequest(url: url(path, query: query))
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }

    func webSocketRequest(_ path: String = "/api/ws", query: [String: String] = [:]) -> URLRequest {
        var comps = URLComponents(url: url(path, query: query), resolvingAgainstBaseURL: false)!
        comps.scheme = "ws"
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 15
        return req
    }

    private func check(_ data: Data, _ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            struct ErrorBody: Decodable { var error: String }
            let message = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError(status: http.statusCode, message: message)
        }
    }

    func data(_ method: String = "GET", _ path: String, query: [String: String] = [:], json: [String: Any]? = nil, timeout: TimeInterval? = nil) async throws -> Data {
        var req = request(method, path, query: query)
        if let timeout { req.timeoutInterval = timeout }
        if let json {
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: req)
        try check(data, response)
        return data
    }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        let data = try await self.data("GET", path, query: query)
        return try decoder.decode(T.self, from: data)
    }

    @discardableResult
    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], json: [String: Any]? = nil, as type: T.Type = Empty.self, timeout: TimeInterval? = nil) async throws -> T {
        let data = try await self.data(method, path, query: query, json: json, timeout: timeout)
        if T.self == Empty.self { return Empty() as! T }
        return try decoder.decode(T.self, from: data)
    }

    /// Stream a local file to the PC.
    func upload(fileURL: URL, toPCPath path: String, overwrite: Bool = false) async throws {
        var req = request("PUT", "/api/fs/file", query: ["path": path, "overwrite": overwrite ? "1" : "0"])
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60 * 30
        let (data, response) = try await session.upload(for: req, fromFile: fileURL)
        try check(data, response)
    }

    func upload(data body: Data, toPCPath path: String, overwrite: Bool = false) async throws {
        var req = request("PUT", "/api/fs/file", query: ["path": path, "overwrite": overwrite ? "1" : "0"])
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60 * 30
        let (data, response) = try await session.upload(for: req, from: body)
        try check(data, response)
    }

    /// Download a PC file into a temporary folder, keeping its name (so previews know the type).
    func download(pcPath: String) async throws -> URL {
        var req = request("GET", "/api/fs/file", query: ["path": pcPath])
        req.timeoutInterval = 60 * 30
        let (tmp, response) = try await session.download(for: req)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let body = (try? Data(contentsOf: tmp)) ?? Data()
            try check(body, response)
        }
        let name = pcPath.split(whereSeparator: { $0 == "\\" || $0 == "/" }).last.map(String.init) ?? "download"
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }
}
