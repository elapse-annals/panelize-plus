import Foundation

public struct VersionHTTPResponse: Equatable {
    public let statusCode: Int
    public let data: Data

    public init(statusCode: Int, data: Data) {
        self.statusCode = statusCode
        self.data = data
    }
}

public protocol VersionHTTPClient {
    func perform(
        _ request: URLRequest,
        completion: @escaping (Result<VersionHTTPResponse, VersionCheckError>) -> Void
    )
}

public enum VersionCheckError: Error, Equatable {
    case timeout
    case network
    case invalidResponse
}

public enum UpdateCheckSource: Equatable {
    case githubAPI
    case publishedVersionInfo
}

public struct UpdateCheckResult: Equatable {
    public let currentVersion: String
    public let latestVersion: String
    public let releaseURL: URL
    public let updateAvailable: Bool
    public let source: UpdateCheckSource

    public init(
        currentVersion: String,
        latestVersion: String,
        releaseURL: URL,
        updateAvailable: Bool,
        source: UpdateCheckSource
    ) {
        self.currentVersion = currentVersion
        self.latestVersion = latestVersion
        self.releaseURL = releaseURL
        self.updateAvailable = updateAvailable
        self.source = source
    }
}

public protocol VersionChecking {
    func checkForUpdates(
        completion: @escaping (Result<UpdateCheckResult, VersionCheckError>) -> Void
    )
}

public final class URLSessionVersionHTTPClient: VersionHTTPClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func perform(
        _ request: URLRequest,
        completion: @escaping (Result<VersionHTTPResponse, VersionCheckError>) -> Void
    ) {
        session.dataTask(with: request) { data, response, error in
            if let error {
                if (error as? URLError)?.code == .timedOut {
                    completion(.failure(.timeout))
                } else {
                    completion(.failure(.network))
                }
                return
            }
            guard let httpResponse = response as? HTTPURLResponse,
                  let data else {
                completion(.failure(.invalidResponse))
                return
            }
            completion(.success(VersionHTTPResponse(
                statusCode: httpResponse.statusCode,
                data: data
            )))
        }.resume()
    }
}

public final class VersionChecker: VersionChecking {
    public static let latestReleaseAPIURL = URL(
        string: "https://api.github.com/repos/elapse-annals/panelize-plus/releases/latest"
    )!
    public static let publishedVersionInfoURL = URL(
        string: "https://raw.githubusercontent.com/elapse-annals/panelize-plus/master/data/version-info.json"
    )!
    public static let releasesPageURL = URL(
        string: "https://github.com/elapse-annals/panelize-plus/releases/latest"
    )!
    public static let requestTimeout: TimeInterval = 10

    private let currentVersion: String
    private let httpClient: VersionHTTPClient
    private let callbackQueue: DispatchQueue

    public init(
        currentVersion: String? = nil,
        httpClient: VersionHTTPClient = URLSessionVersionHTTPClient(),
        bundle: Bundle = .main,
        callbackQueue: DispatchQueue = .main
    ) {
        self.currentVersion = currentVersion ?? VersionUtils.currentAppVersion(bundle: bundle)
        self.httpClient = httpClient
        self.callbackQueue = callbackQueue
    }

    public func checkForUpdates(
        completion: @escaping (Result<UpdateCheckResult, VersionCheckError>) -> Void
    ) {
        requestLatestRelease { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let release):
                self.finish(
                    latestVersion: release.version,
                    releaseURL: release.url,
                    source: .githubAPI,
                    completion: completion
                )
            case .failure(let apiError):
                self.requestPublishedVersionInfo { [weak self] fallbackResult in
                    guard let self else { return }
                    switch fallbackResult {
                    case .success(let release):
                        self.finish(
                            latestVersion: release.version,
                            releaseURL: release.url,
                            source: .publishedVersionInfo,
                            completion: completion
                        )
                    case .failure(let fallbackError):
                        self.deliver(
                            .failure(Self.preferredError(apiError, fallbackError)),
                            completion
                        )
                    }
                }
            }
        }
    }

    private func requestLatestRelease(
        completion: @escaping (Result<(version: String, url: URL), VersionCheckError>) -> Void
    ) {
        var request = URLRequest(url: Self.latestReleaseAPIURL)
        request.timeoutInterval = Self.requestTimeout
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("PanelizeLink/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        httpClient.perform(request) { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let response):
                guard (200..<300).contains(response.statusCode),
                      let json = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
                      let tag = json["tag_name"] as? String,
                      let version = VersionUtils.normalizedVersion(tag),
                      let urlString = json["html_url"] as? String,
                      let url = URL(string: urlString),
                      url.scheme == "https" else {
                    completion(.failure(.invalidResponse))
                    return
                }
                completion(.success((version, url)))
            }
        }
    }

    private func requestPublishedVersionInfo(
        completion: @escaping (Result<(version: String, url: URL), VersionCheckError>) -> Void
    ) {
        var request = URLRequest(url: Self.publishedVersionInfoURL)
        request.timeoutInterval = Self.requestTimeout
        request.setValue("PanelizeLink/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        httpClient.perform(request) { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let response):
                guard (200..<300).contains(response.statusCode),
                      let json = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
                      let rawVersion = json["version"] as? String,
                      let version = VersionUtils.normalizedVersion(rawVersion) else {
                    completion(.failure(.invalidResponse))
                    return
                }
                completion(.success((version, Self.releasesPageURL)))
            }
        }
    }

    private func finish(
        latestVersion: String,
        releaseURL: URL,
        source: UpdateCheckSource,
        completion: @escaping (Result<UpdateCheckResult, VersionCheckError>) -> Void
    ) {
        let result = UpdateCheckResult(
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            releaseURL: releaseURL,
            updateAvailable: VersionUtils.compareVersions(currentVersion, latestVersion) == .orderedAscending,
            source: source
        )
        deliver(.success(result), completion)
    }

    private func deliver(
        _ result: Result<UpdateCheckResult, VersionCheckError>,
        _ completion: @escaping (Result<UpdateCheckResult, VersionCheckError>) -> Void
    ) {
        callbackQueue.async {
            completion(result)
        }
    }

    private static func preferredError(
        _ first: VersionCheckError,
        _ second: VersionCheckError
    ) -> VersionCheckError {
        if first == .timeout || second == .timeout {
            return .timeout
        }
        if first == .network || second == .network {
            return .network
        }
        return .invalidResponse
    }
}
