import XCTest
@testable import PanelizeSearchCore

private final class FakeVersionHTTPClient: VersionHTTPClient {
    private(set) var requests: [URLRequest] = []
    var results: [Result<VersionHTTPResponse, VersionCheckError>] = []

    func perform(
        _ request: URLRequest,
        completion: @escaping (Result<VersionHTTPResponse, VersionCheckError>) -> Void
    ) {
        requests.append(request)
        let result = results.isEmpty ? .failure(.network) : results.removeFirst()
        completion(result)
    }
}

final class VersionCheckerTests: XCTestCase {
    private func response(_ statusCode: Int, _ body: String) -> VersionHTTPResponse {
        VersionHTTPResponse(statusCode: statusCode, data: Data(body.utf8))
    }

    private func checker(
        client: FakeVersionHTTPClient,
        currentVersion: String = "2.95.0"
    ) -> VersionChecker {
        VersionChecker(
            currentVersion: currentVersion,
            httpClient: client,
            callbackQueue: .main
        )
    }

    func testGitHubReleaseSuccessReportsAnUpdateAndRequestHeaders() {
        let client = FakeVersionHTTPClient()
        client.results = [.success(response(200, """
        {"tag_name":"v2.95.1","html_url":"https://github.com/elapse-annals/panelize-plus/releases/tag/v2.95.1"}
        """))]

        let expectation = expectation(description: "update check")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .success(let result) = received else {
            return XCTFail("Expected a successful check")
        }
        XCTAssertEqual(result.currentVersion, "2.95.0")
        XCTAssertEqual(result.latestVersion, "2.95.1")
        XCTAssertEqual(result.source, .githubAPI)
        XCTAssertTrue(result.updateAvailable)
        XCTAssertEqual(
            result.releaseURL.absoluteString,
            "https://github.com/elapse-annals/panelize-plus/releases/tag/v2.95.1"
        )

        XCTAssertEqual(client.requests.count, 1)
        let request = client.requests[0]
        XCTAssertEqual(request.url, VersionChecker.latestReleaseAPIURL)
        XCTAssertEqual(request.timeoutInterval, VersionChecker.requestTimeout)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/vnd.github+json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "PanelizeLink/2.95.0")
    }

    func testEqualAndOlderLatestVersionsAreNotUpdates() {
        for latest in ["2.95.0", "2.94.9"] {
            let client = FakeVersionHTTPClient()
            client.results = [.success(response(200, """
            {"tag_name":"v\(latest)","html_url":"https://github.com/elapse-annals/panelize-plus/releases/tag/v\(latest)"}
            """))]

            let expectation = expectation(description: "check \(latest)")
            var received: Result<UpdateCheckResult, VersionCheckError>?
            checker(client: client).checkForUpdates { result in
                received = result
                expectation.fulfill()
            }
            wait(for: [expectation], timeout: 1)

            guard case .success(let result) = received else {
                return XCTFail("Expected a successful check for \(latest)")
            }
            XCTAssertFalse(result.updateAvailable)
        }
    }

    func testRateLimitedGitHubFallsBackToPublishedVersionInfo() {
        let client = FakeVersionHTTPClient()
        client.results = [
            .success(response(403, "{}")),
            .success(response(200, """
            {"version":"2.95.2","commitHash":"abc1234","buildDate":"2026-11-13"}
            """))
        ]

        let expectation = expectation(description: "fallback check")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .success(let result) = received else {
            return XCTFail("Expected the fallback to succeed")
        }
        XCTAssertEqual(result.latestVersion, "2.95.2")
        XCTAssertEqual(result.source, .publishedVersionInfo)
        XCTAssertEqual(result.releaseURL, VersionChecker.releasesPageURL)
        XCTAssertTrue(result.updateAvailable)
        XCTAssertEqual(client.requests.count, 2)
        XCTAssertEqual(client.requests[1].url, VersionChecker.publishedVersionInfoURL)
    }

    func testNetworkFailureAlsoFallsBackToPublishedVersionInfo() {
        let client = FakeVersionHTTPClient()
        client.results = [
            .failure(.network),
            .success(response(200, #"{"version":"2.95.1"}"#))
        ]

        let expectation = expectation(description: "fallback check")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .success(let result) = received else {
            return XCTFail("Expected the fallback to succeed")
        }
        XCTAssertEqual(result.source, .publishedVersionInfo)
    }

    func testMalformedResponsesFromBothSourcesReportInvalidResponse() {
        let client = FakeVersionHTTPClient()
        client.results = [
            .success(response(200, "not json")),
            .success(response(200, #"{"version":"latest"}"#))
        ]

        let expectation = expectation(description: "failure")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .failure(let error) = received else {
            return XCTFail("Expected the check to fail")
        }
        XCTAssertEqual(error, .invalidResponse)
    }

    func testTimeoutsArePreferredWhenBothRequestsTimeOut() {
        let client = FakeVersionHTTPClient()
        client.results = [.failure(.timeout), .failure(.timeout)]

        let expectation = expectation(description: "timeout")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .failure(let error) = received else {
            return XCTFail("Expected the check to fail")
        }
        XCTAssertEqual(error, .timeout)
    }

    func testNetworkErrorsAreReportedWhenBothRequestsFailOverTheNetwork() {
        let client = FakeVersionHTTPClient()
        client.results = [.failure(.network), .failure(.invalidResponse)]

        let expectation = expectation(description: "network failure")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client).checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .failure(let error) = received else {
            return XCTFail("Expected the check to fail")
        }
        XCTAssertEqual(error, .network)
    }

    func testInjectedCurrentVersionOverridesTheBundleValue() {
        let client = FakeVersionHTTPClient()
        client.results = [.success(response(200, """
        {"tag_name":"v2.95.1","html_url":"https://example.com/release"}
        """))]

        let expectation = expectation(description: "update check")
        var received: Result<UpdateCheckResult, VersionCheckError>?
        checker(client: client, currentVersion: "2.95.1").checkForUpdates { result in
            received = result
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        guard case .success(let result) = received else {
            return XCTFail("Expected a successful check")
        }
        XCTAssertEqual(result.currentVersion, "2.95.1")
        XCTAssertFalse(result.updateAvailable)
    }
}
