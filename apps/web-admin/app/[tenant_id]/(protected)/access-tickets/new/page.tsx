import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "#components/admin-page";

import { TicketForm } from "../_components/ticket-form";
import { issueAccessTicketAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "アクセスチケット発行",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewAccessTicketPage = () => (
  <AdminPage
    actions={
      <LinkButton render={<Link href="/access-tickets" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description="ユーザーとエピソードを指定して限定閲覧チケットを発行します。"
    title="チケットを発行"
  >
    <TicketForm action={issueAccessTicketAction} />
  </AdminPage>
);

export default NewAccessTicketPage;
