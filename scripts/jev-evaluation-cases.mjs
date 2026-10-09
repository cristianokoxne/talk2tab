const templates = [
  { id: "button", region: "main product card", role: "button", label: "Open product details", goal: "Open the product details", target: 0 },
  { id: "duplicate", region: "billing settings", role: "button", label: "Save changes", goal: "Save the billing changes", target: 1, names: ["Save changes", "Save changes", "Cancel", "Help", "Continue"] },
  { id: "search", region: "site header", role: "searchbox", label: "Search articles", goal: "Search articles for the requested topic", target: 2 },
  { id: "dialog", region: "confirmation dialog", role: "button", label: "Confirm removal", goal: "Confirm removal in the open dialog", target: 3 },
  { id: "menu", region: "account navigation menu", role: "menuitem", label: "Order history", goal: "Open order history from the account menu", target: 4 },
  { id: "form", region: "profile form", role: "textbox", label: "Display name", goal: "Enter the requested display name", target: 0 },
  { id: "select", region: "subscription form", role: "option", label: "Premium annual", goal: "Choose the annual Premium plan", target: 1 },
  { id: "scroll", region: "messages panel", role: "scroll container", label: "Conversation history", goal: "Scroll the messages panel to older messages", target: 2 },
  { id: "tabs", region: "settings navigation", role: "tab", label: "Privacy", goal: "Open privacy settings", target: 3 },
  { id: "ambiguous", region: "results list", role: "link", label: "View details", goal: "Open a matching result", target: 4, acceptable: [3, 4] },
];

export const evaluationCases = templates.flatMap((template, templateIndex) =>
  Array.from({ length: 10 }, (_, variant) => {
    const controls = Array.from({ length: 5 }, (_, index) => ({
      id: `option_${index + 1}`,
      role: template.role,
      name: template.names?.[index] ?? (index === template.target ? `${template.label} ${variant + 1}` : `${["Help", "Cancel", "More information", "Continue", "Other settings"][index]} ${variant + 1}`),
      context: template.names && index !== template.target ? `${template.region}; unrelated action` : template.region,
      enabled: true,
    }));
    const target = template.names ? template.label : controls[template.target].name;
    return {
      id: `${template.id}-${String(variant + 1).padStart(2, "0")}`,
      template: template.id,
      split: templateIndex < 7 ? "development" : "holdout",
      objective: template.goal.replace(template.label, target),
      acceptable: (template.acceptable ?? [template.target]).map((index) => controls[index].id),
      controls,
      structural: { pageRegion: template.region, focus: controls[0].name, modal: template.id === "dialog", listContext: template.id === "ambiguous" ? "search results" : undefined },
      history: [{ action: "click", target: "Help", result: "no navigation occurred" }, { action: "observe", summary: `The ${template.region} is still open.` }],
    };
  }),
);
