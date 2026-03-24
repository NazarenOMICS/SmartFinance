async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (error) {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export const api = {
  getSummary: (month) => request(`/api/transactions/summary?month=${month}`),
  getTransactions: (month) => request(`/api/transactions?month=${month}`),
  updateTransaction: (id, body) =>
    request(`/api/transactions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  createTransaction: (body) =>
    request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  getEvolution: (end, months = 6) => request(`/api/transactions/monthly-evolution?end=${end}&months=${months}`),
  getCategories: () => request("/api/categories"),
  updateCategory: (id, body) =>
    request(`/api/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  getAccounts: () => request("/api/accounts"),
  createAccount: (body) =>
    request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  updateAccount: (id, body) =>
    request(`/api/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  getConsolidatedAccounts: () => request("/api/accounts/consolidated"),
  getRules: () => request("/api/rules"),
  createRule: (body) =>
    request("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  deleteRule: (id) =>
    request(`/api/rules/${id}`, {
      method: "DELETE"
    }),
  getInstallments: () => request("/api/installments"),
  createInstallment: (body) =>
    request("/api/installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  updateInstallment: (id, body) =>
    request(`/api/installments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  deleteInstallment: (id) =>
    request(`/api/installments/${id}`, {
      method: "DELETE"
    }),
  getCommitments: (start, months = 6) => request(`/api/installments/commitments?start=${start}&months=${months}`),
  getSettings: () => request("/api/settings"),
  updateSetting: (key, value) =>
    request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value })
    }),
  getProjection: (end, months = 12) => request(`/api/savings/projection?end=${end}&months=${months}`),
  getInsights: (month) => request(`/api/savings/insights?month=${month}`),
  getUploads: (period) => request(`/api/upload?period=${period}`),
  uploadFile: (formData) =>
    request("/api/upload", {
      method: "POST",
      body: formData
    })
};
