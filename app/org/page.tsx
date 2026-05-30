import { redirect } from "next/navigation";

// /org is folded into the home board (/). A steward's home IS their composed
// admin board, and the header "view as" switch previews any role's slice. This
// redirect keeps existing /org links and bookmarks landing on the board.
export default function OrgPage(): never {
  redirect("/");
}
