class Cart < ApplicationRecord
  has_many :cart_items, dependent: :destroy
  has_many :products, through: :cart_items

  validates :session_token, presence: true, uniqueness: true

  def self.find_or_create_by_token(token)
    find_or_create_by(session_token: token)
  end

  def add_product(product, quantity = 1)
    item = cart_items.find_or_initialize_by(product: product)
    item.quantity = (item.quantity || 0) + quantity
    item.save!
    item
  end

  def update_item_quantity(product_id, quantity)
    item = cart_items.find_by(product_id: product_id)
    return nil unless item

    if quantity <= 0
      item.destroy
      nil
    else
      item.update!(quantity: quantity)
      item
    end
  end

  def remove_product(product_id)
    cart_items.find_by(product_id: product_id)&.destroy
  end

  def clear!
    cart_items.destroy_all
  end

  def total
    cart_items.includes(:product).sum { |item| item.product.price * item.quantity }
  end

  def item_count
    cart_items.sum(:quantity)
  end

  def as_json(options = {})
    {
      id: id,
      session_token: session_token,
      items: cart_items.includes(:product).map do |item|
        {
          product: item.product.as_json,
          quantity: item.quantity
        }
      end,
      total: total.to_f,
      item_count: item_count
    }
  end
end
