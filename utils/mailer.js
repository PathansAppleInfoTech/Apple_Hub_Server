const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure:
        String(process.env.SMTP_SECURE).toLowerCase() === 'true',

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

/*
 * --------------------------------------------------
 * Verify SMTP connection
 * --------------------------------------------------
 *
 * This runs when the server starts.
 * It helps identify incorrect SMTP credentials early.
 * --------------------------------------------------
 */
async function verifyMailer() {
    try {
        await transporter.verify();

        console.log(
            '[mailer] SMTP connection verified successfully'
        );
    } catch (error) {
        console.error(
            '[mailer] SMTP connection failed:',
            error.message
        );
    }
}

/*
 * --------------------------------------------------
 * Escape HTML
 * --------------------------------------------------
 *
 * Customer-provided values should never be inserted
 * directly into HTML.
 * --------------------------------------------------
 */
function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/*
 * --------------------------------------------------
 * Order confirmation email
 * --------------------------------------------------
 */

async function sendOrderConfirmationEmail(order) {
    if (!order?.customer_email) {
        throw new Error(
            'Customer email is required to send order confirmation'
        );
    }

    // ----------------------------------------------------------
    // Basic values
    // ----------------------------------------------------------

    const companyGSTIN = '32AAOCP4547L1ZZ';

    const customerName =
        escapeHtml(order.customer_name || 'Customer');

    const orderNumber =
        escapeHtml(order.order_number || '');

    const serviceTitle =
        escapeHtml(order.service_title || 'Service');

    const paymentId =
        escapeHtml(
            order.razorpay_payment_id || 'Not available'
        );

    const razorpayOrderId =
        escapeHtml(
            order.razorpay_order_id || 'Not available'
        );

    const paymentMethod =
        escapeHtml(
            order.payment_method || 'Online Payment'
        );

    // ----------------------------------------------------------
    // Amounts
    // ----------------------------------------------------------

    const amount =
        Number(order.amount || 0);

    const taxType =
        order.tax_type === 'included'
            ? 'included'
            : 'not_applicable';

    const taxRate =
        order.tax_rate !== null &&
            order.tax_rate !== undefined
            ? Number(order.tax_rate)
            : null;

    const taxableAmount =
        Number(order.taxable_amount || 0);

    const taxAmount =
        Number(order.tax_amount || 0);

    // ----------------------------------------------------------
    // Currency formatter
    // ----------------------------------------------------------

    const formatCurrency = (value) =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 2,
        }).format(Number(value || 0));

    const formattedAmount =
        formatCurrency(amount);

    const formattedTaxableAmount =
        formatCurrency(taxableAmount);

    const formattedTaxAmount =
        formatCurrency(taxAmount);

    // ----------------------------------------------------------
    // Customer details
    // ----------------------------------------------------------

    const customerPhone =
        escapeHtml(order.customer_phone || '');

    const customerAddress =
        escapeHtml(order.customer_address || '');

    // ----------------------------------------------------------
    // Logo
    // ----------------------------------------------------------

    const logoUrl =
        'https://ecom.pathansapple.com/assets/images/logo.png';

    // ----------------------------------------------------------
    // Order URL
    // ----------------------------------------------------------

    const orderUrl =
        `https://ecom.pathansapple.com/order-success/${encodeURIComponent(
            order.order_number
        )}`;

    // ----------------------------------------------------------
    // TAX DISPLAY
    // ----------------------------------------------------------

    let taxSectionHtml = '';

    if (taxType === 'included') {
        taxSectionHtml = `
      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:13px;
          "
        >
          Taxable Amount
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#17182b;
            font-size:13px;
            font-weight:700;
          "
        >
          ${formattedTaxableAmount}
        </td>
      </tr>

      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:13px;
          "
        >
          GST (${taxRate}%)
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#17182b;
            font-size:13px;
            font-weight:700;
          "
        >
          ${formattedTaxAmount}
        </td>
      </tr>

      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:13px;
          "
        >
          GST Status
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#16834b;
            font-size:12px;
            font-weight:800;
          "
        >
          INCLUDED IN PRICE
        </td>
      </tr>

      <!-- GSTIN -->
      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:13px;
          "
        >
          GSTIN
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#17182b;
            font-size:13px;
            font-weight:700;
          "
        >
          ${companyGSTIN}
        </td>
      </tr>

      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#17182b;
            font-size:14px;
            font-weight:800;
          "
        >
          Total Amount Paid
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#5b3df0;
            font-size:17px;
            font-weight:900;
          "
        >
          ${formattedAmount}
        </td>
      </tr>

      <tr>
        <td
          colspan="2"
          style="
            padding:0 18px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:11px;
            line-height:1.6;
          "
        >
          The displayed service price includes
          ${taxRate}% GST. No additional GST has
          been charged at checkout.
        </td>
      </tr>
    `;
    } else {
        taxSectionHtml = `
      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:13px;
          "
        >
          GST
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#16834b;
            font-size:12px;
            font-weight:800;
          "
        >
          NOT APPLICABLE
        </td>
      </tr>

      <tr>
        <td
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#17182b;
            font-size:14px;
            font-weight:800;
          "
        >
          Total Amount Paid
        </td>

        <td
          align="right"
          style="
            padding:17px 18px;
            border-top:1px solid #eeeeF3;
            color:#5b3df0;
            font-size:17px;
            font-weight:900;
          "
        >
          ${formattedAmount}
        </td>
      </tr>

      <tr>
        <td
          colspan="2"
          style="
            padding:0 18px 18px;
            border-top:1px solid #eeeeF3;
            color:#716f82;
            font-size:11px;
            line-height:1.6;
          "
        >
          GST is not applicable to this service.
          No additional GST has been charged.
        </td>
      </tr>
    `;
    }

    // ----------------------------------------------------------
    // HTML EMAIL
    // ----------------------------------------------------------

    const html = `
    <html lang="en">
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <title>Order Confirmed - Apple Hub</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f7f7fb;
          font-family:Arial,Helvetica,sans-serif;
          color:#17182b;
        "
      >

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            background:#f7f7fb;
            padding:40px 16px;
          "
        >
          <tr>
            <td align="center">

              <!-- Main container -->
              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  max-width:620px;
                  background:#ffffff;
                  border-radius:24px;
                  overflow:hidden;
                  border:1px solid #e9e9f0;
                  box-shadow:0 10px 35px rgba(21,22,43,0.06);
                "
              >

                <!-- Header -->
                <tr>
                  <td
                    style="
                      padding:28px 32px;
                      border-bottom:1px solid #eeeeF3;
                    "
                  >

                    <table
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                    >
                      <tr>

                        <td>
                          <img
                            src="${logoUrl}"
                            alt="Apple Hub"
                            style="
                              display:block;
                              width:150px;
                              max-width:100%;
                              height:auto;
                            "
                          />
                        </td>

                        <td
                          align="right"
                          style="
                            font-size:12px;
                            font-weight:700;
                            color:#716f82;
                          "
                        >
                          ORDER CONFIRMATION
                        </td>

                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Success section -->
                <tr>
                  <td
                    style="
                      padding:42px 32px 30px;
                      text-align:center;
                    "
                  >

                    <div
                      style="
                        width:64px;
                        height:64px;
                        margin:0 auto 20px;
                        border-radius:50%;
                        background:#eeeafe;
                        color:#5b3df0;
                        font-size:30px;
                        line-height:64px;
                        font-weight:700;
                      "
                    >
                      ✓
                    </div>

                    <h1
                      style="
                        margin:0;
                        font-size:28px;
                        line-height:1.25;
                        color:#17182b;
                      "
                    >
                      Payment Confirmed
                    </h1>

                    <p
                      style="
                        margin:12px auto 0;
                        max-width:460px;
                        font-size:15px;
                        line-height:1.7;
                        color:#716f82;
                      "
                    >
                      Thank you, ${customerName}.
                      Your payment has been successfully
                      received and your order is now confirmed.
                    </p>

                  </td>
                </tr>

                <!-- Order number -->
                <tr>
                  <td style="padding:0 32px 26px;">

                    <table
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      style="
                        background:#f6f4ff;
                        border:1px solid #e7e2ff;
                        border-radius:16px;
                      "
                    >
                      <tr>

                        <td style="padding:18px 20px;">

                          <p
                            style="
                              margin:0 0 5px;
                              font-size:11px;
                              font-weight:700;
                              letter-spacing:1px;
                              text-transform:uppercase;
                              color:#817e95;
                            "
                          >
                            Order Number
                          </p>

                          <p
                            style="
                              margin:0;
                              font-size:20px;
                              font-weight:800;
                              color:#5b3df0;
                            "
                          >
                            ${orderNumber}
                          </p>

                        </td>

                        <td
                          align="right"
                          style="padding:18px 20px;"
                        >
                          <span
                            style="
                              display:inline-block;
                              padding:7px 12px;
                              border-radius:30px;
                              background:#e8f8ef;
                              color:#16834b;
                              font-size:11px;
                              font-weight:800;
                              text-transform:uppercase;
                              letter-spacing:.5px;
                            "
                          >
                            Confirmed
                          </span>
                        </td>

                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Service -->
                <tr>
                  <td style="padding:0 32px 26px;">

                    <h2
                      style="
                        margin:0 0 14px;
                        font-size:14px;
                        color:#17182b;
                      "
                    >
                      Order Details
                    </h2>

                    <table
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      style="
                        border:1px solid #e9e9f0;
                        border-radius:16px;
                      "
                    >

                      <!-- Service -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          Service
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            color:#17182b;
                            font-size:13px;
                            font-weight:700;
                          "
                        >
                          ${serviceTitle}
                        </td>
                      </tr>

                      ${taxType === 'included'
            ? `
                      <!-- Taxable amount -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          Taxable Amount
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#17182b;
                            font-size:13px;
                            font-weight:700;
                          "
                        >
                          ${formattedTaxableAmount}
                        </td>
                      </tr>

                      <!-- GST -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          GST (${taxRate}%)
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#17182b;
                            font-size:13px;
                            font-weight:700;
                          "
                        >
                          ${formattedTaxAmount}
                        </td>
                      </tr>

                      <!-- GST status -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          GST Status
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#16834b;
                            font-size:12px;
                            font-weight:800;
                          "
                        >
                          INCLUDED IN PRICE
                        </td>
                      </tr>

                      <!-- GSTIN -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          GSTIN
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#17182b;
                            font-size:13px;
                            font-weight:700;
                            word-break:break-all;
                          "
                        >
                          ${companyGSTIN}
                        </td>
                      </tr>

                      <!-- Total -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#17182b;
                            font-size:14px;
                            font-weight:800;
                          "
                        >
                          Total Amount Paid
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#5b3df0;
                            font-size:17px;
                            font-weight:900;
                          "
                        >
                          ${formattedAmount}
                        </td>
                      </tr>

                      <!-- Tax note -->
                      <tr>
                        <td
                          colspan="2"
                          style="
                            padding:0 18px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:11px;
                            line-height:1.6;
                          "
                        >
                          The displayed service price includes
                          ${taxRate}% GST. No additional GST has
                          been charged at checkout.
                        </td>
                      </tr>
                      `
            : `
                      <!-- Amount -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          Amount Paid
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#5b3df0;
                            font-size:17px;
                            font-weight:900;
                          "
                        >
                          ${formattedAmount}
                        </td>
                      </tr>

                      <!-- GST -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          GST
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#16834b;
                            font-size:12px;
                            font-weight:800;
                          "
                        >
                          NOT APPLICABLE
                        </td>
                      </tr>

                      <!-- Tax note -->
                      <tr>
                        <td
                          colspan="2"
                          style="
                            padding:0 18px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:11px;
                            line-height:1.6;
                          "
                        >
                          GST is not applicable to this service.
                          No additional GST has been charged.
                        </td>
                      </tr>
                      `
        }

                      <!-- Payment status -->
                      <tr>
                        <td
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#716f82;
                            font-size:13px;
                          "
                        >
                          Payment Status
                        </td>

                        <td
                          align="right"
                          style="
                            padding:17px 18px;
                            border-top:1px solid #eeeeF3;
                            color:#16834b;
                            font-size:13px;
                            font-weight:800;
                          "
                        >
                          PAID
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>

                <!-- Customer details -->
                <tr>
                  <td style="padding:0 32px 26px;">

                    <h2
                      style="
                        margin:0 0 14px;
                        font-size:14px;
                        color:#17182b;
                      "
                    >
                      Customer Details
                    </h2>

                    <table
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      style="
                        background:#fafafd;
                        border-radius:16px;
                      "
                    >

                      <tr>
                        <td
                          style="
                            padding:14px 18px 5px;
                            font-size:12px;
                            color:#817e95;
                          "
                        >
                          Name
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:0 18px 14px;
                            font-size:13px;
                            font-weight:700;
                            color:#17182b;
                          "
                        >
                          ${customerName}
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:5px 18px;
                            font-size:12px;
                            color:#817e95;
                          "
                        >
                          Phone
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:0 18px 14px;
                            font-size:13px;
                            font-weight:700;
                            color:#17182b;
                          "
                        >
                          ${customerPhone}
                        </td>
                      </tr>

                      ${customerAddress
            ? `
                      <tr>
                        <td
                          style="
                            padding:5px 18px;
                            font-size:12px;
                            color:#817e95;
                          "
                        >
                          Address
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:0 18px 18px;
                            font-size:13px;
                            font-weight:700;
                            line-height:1.5;
                            color:#17182b;
                          "
                        >
                          ${customerAddress}
                        </td>
                      </tr>
                      `
            : ''
        }

                    </table>

                  </td>
                </tr>

                <!-- Payment reference -->
                <tr>
                  <td style="padding:0 32px 30px;">

                    <h2
                      style="
                        margin:0 0 14px;
                        font-size:14px;
                        color:#17182b;
                      "
                    >
                      Payment Reference
                    </h2>

                    <table
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      style="
                        border:1px solid #e9e9f0;
                        border-radius:16px;
                      "
                    >

                      <tr>
                        <td
                          style="
                            padding:13px 18px;
                            font-size:11px;
                            color:#817e95;
                          "
                        >
                          Payment ID
                        </td>

                        <td
                          align="right"
                          style="
                            padding:13px 18px;
                            font-size:11px;
                            font-weight:700;
                            color:#17182b;
                            word-break:break-all;
                          "
                        >
                          ${paymentId}
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:13px 18px;
                            border-top:1px solid #eeeeF3;
                            font-size:11px;
                            color:#817e95;
                          "
                        >
                          Razorpay Order ID
                        </td>

                        <td
                          align="right"
                          style="
                            padding:13px 18px;
                            border-top:1px solid #eeeeF3;
                            font-size:11px;
                            font-weight:700;
                            color:#17182b;
                            word-break:break-all;
                          "
                        >
                          ${razorpayOrderId}
                        </td>
                      </tr>

                      <tr>
                        <td
                          style="
                            padding:13px 18px;
                            border-top:1px solid #eeeeF3;
                            font-size:11px;
                            color:#817e95;
                          "
                        >
                          Payment Method
                        </td>

                        <td
                          align="right"
                          style="
                            padding:13px 18px;
                            border-top:1px solid #eeeeF3;
                            font-size:11px;
                            font-weight:700;
                            color:#17182b;
                          "
                        >
                          ${paymentMethod}
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td
                    align="center"
                    style="padding:0 32px 36px;"
                  >

                    <a
                      href="${orderUrl}"
                      style="
                        display:inline-block;
                        padding:14px 25px;
                        border-radius:999px;
                        background:#5b3df0;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:13px;
                        font-weight:800;
                      "
                    >
                      View Order Details
                    </a>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td
                    style="
                      padding:24px 32px;
                      background:#fafafd;
                      border-top:1px solid #eeeeF3;
                      text-align:center;
                    "
                  >

                    <p
                      style="
                        margin:0;
                        font-size:13px;
                        font-weight:800;
                        color:#17182b;
                      "
                    >
                      Apple Hub
                    </p>

                    <p
                      style="
                        margin:7px 0 0;
                        font-size:11px;
                        line-height:1.6;
                        color:#817e95;
                      "
                    >
                      by Pathans Apple Info Tech
                    </p>

                    <p
                      style="
                        margin:12px 0 0;
                        font-size:10px;
                        color:#aaa8b7;
                      "
                    >
                      This is an automated order confirmation.
                      Please do not reply to this email.
                    </p>

                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>

      </body>
    </html>
  `;

    // ----------------------------------------------------------
    // PLAIN TEXT EMAIL
    // ----------------------------------------------------------

    const text =
        taxType === 'included'
            ? `
Apple Hub — Order Confirmed

Hello ${order.customer_name || 'Customer'},

Your payment has been successfully received and your order is confirmed.

Order Number: ${order.order_number}
Service: ${order.service_title}

Taxable Amount: ${formattedTaxableAmount}
GST (${taxRate}%): ${formattedTaxAmount}
GST Status: Included in price
GSTIN: ${companyGSTIN}

Total Amount Paid: ${formattedAmount}

The displayed service price includes ${taxRate}% GST.
No additional GST has been charged at checkout.

Payment Status: PAID

Payment ID: ${order.razorpay_payment_id || 'Not available'
                }

Razorpay Order ID: ${order.razorpay_order_id || 'Not available'
                }

Payment Method: ${order.payment_method || 'Online Payment'
                }

Thank you for choosing Apple Hub.

View your order:
${orderUrl}

Apple Hub
by Pathans Apple Info Tech
      `.trim()
            : `
Apple Hub — Order Confirmed

Hello ${order.customer_name || 'Customer'},

Your payment has been successfully received and your order is confirmed.

Order Number: ${order.order_number}
Service: ${order.service_title}

Amount Paid: ${formattedAmount}
GST: Not applicable

No additional GST has been charged.

Payment Status: PAID

Payment ID: ${order.razorpay_payment_id || 'Not available'
                }

Razorpay Order ID: ${order.razorpay_order_id || 'Not available'
                }

Payment Method: ${order.payment_method || 'Online Payment'
                }

Thank you for choosing Apple Hub.

View your order:
${orderUrl}

Apple Hub
by Pathans Apple Info Tech
      `.trim();

    // ----------------------------------------------------------
    // SEND EMAIL
    // ----------------------------------------------------------

    const info =
        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME || 'Apple Hub'}" <${process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER}>`,

            to: order.customer_email,

            subject:
                `Order Confirmed — ${order.order_number} | Apple Hub`,

            text,
            html,
        });

    console.log(
        `[mailer] Order confirmation sent | order=${order.order_number} | email=${order.customer_email} | messageId=${info.messageId}`
    );

    return info;
}


module.exports = {
    transporter,
    verifyMailer,
    sendOrderConfirmationEmail,
};
