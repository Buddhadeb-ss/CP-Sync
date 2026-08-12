# Privacy Policy for CP Sync

**Effective Date:** July 28, 2026

This Privacy Policy describes how the "CP Sync" browser extension ("the Extension") handles your data. CP Sync is designed with strict privacy principles: **CP Sync does not collect or transmit your data to servers operated by the developer. Data is processed locally in your browser and, when you use the synchronization feature, submitted directly to the GitHub API to create commits in your configured repository.**

### 1. Data We Collect and How It Is Used

To function properly, the Extension requires certain information to be provided by you and accessed within your browser:

*   **GitHub Personal Access Token & Account Details:** CP Sync stores the GitHub Personal Access Token provided by the user in Chrome extension storage and uses it solely to authenticate requests to the GitHub API. The token is not transmitted to servers operated by the CP Sync developer or used for any purpose other than the GitHub synchronization functionality.
*   **Submission Data:** The Extension reads problem metadata (such as problem name, ID, and URL) and your submitted code from supported competitive programming websites (e.g., Codeforces, LeetCode, CodeChef, AtCoder, etc.) when you receive an "Accepted" verdict. This data is used solely to construct a commit and push it to your connected GitHub repository.

### 2. Data Storage

Settings and extension data are stored using Chrome's extension storage API. The developer does not have access to this stored data.

*   **Developer Access:** CP Sync does not send your GitHub token, submitted code, or push history to servers operated by the developer. The developer does not have access to this information through the Extension.
*   **Data Export:** If you choose to use the "Export settings" feature, your Personal Access Token is deliberately excluded from the exported file to prevent accidental sharing or leaks.

### 3. Third-Party Services

The Extension communicates directly with third-party services to fulfill its core functionality:

*   **GitHub API:** Your submission data and authentication token are transmitted securely via HTTPS directly to the GitHub API (`api.github.com`) to create commits in your repository. You are subject to GitHub's Privacy Policy when interacting with their services.
*   **Supported Platforms:** The Extension runs scripts on supported competitive programming platforms to read the public problem data and your solution code. 

### 4. Data Sharing and Telemetry

*   **No Telemetry:** The Extension does not include any analytics, tracking scripts, or telemetry. We do not track how you use the Extension.
*   **No Data Sharing:** We do not sell, rent, or share any of your data with third parties. All data transmission occurs strictly between your browser and GitHub.

### 5. Permissions Justification

The Extension requests the following browser permissions for these specific reasons:

*   `storage` / `unlimitedStorage`: To securely save your configuration settings, GitHub token, and push history locally.
*   `host_permissions` (e.g., `*://*.codeforces.com/*`, `*://api.github.com/*`): To read your submission status on supported coding platforms and transmit the code directly to the GitHub API.
*   `activeTab` / `scripting`: To support the "Autofill" feature in the Manual Push tab, allowing the Extension to securely read problem metadata from the currently active tab.
*   `notifications`: To provide brief, non-intrusive status alerts when a background code push succeeds or fails.

**Chrome Web Store Limited Use Disclosure:** CP Sync's use of information obtained through browser permissions is limited to providing and improving the Extension's single purpose. User data is not sold, used for advertising, or transferred to third parties except where necessary to provide the Extension's functionality, such as sending the user's selected submission to the GitHub API at the user's direction.

### 6. Changes to This Policy

We may update this Privacy Policy from time to time if the Extension's features change or if required by browser extension store policies. Any changes will be reflected by updating the "Effective Date" at the top of this document.

### 7. Contact

If you have any questions or concerns about this Privacy Policy or how CP Sync handles your data, please contact the developer by opening an issue on the [CP Sync GitHub Repository](https://github.com/nafiuw/CP-Sync).
